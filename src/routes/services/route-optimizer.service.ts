import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';
import { randomUUID } from 'crypto';
import type { RouteDto } from '../dto/route.dto';
import { GraphHopperPath } from '../interfaces/graphhopper.interface';
import { GraphHopperService } from './graphhopper.service';
import { RouteUtilService } from './route-util.service';

/**
 * 카테고리 정보가 포함된 경로 인터페이스
 */
export interface CategorizedPath extends GraphHopperPath {
  routeCategory: string;
  bikeRoadRatio?: number;
  routeId?: string;
}

/**
 * 상수 정의
 */
const MAX_CIRCULAR_ATTEMPTS = 10;
const CIRCULAR_DISTANCE_TOLERANCE = 0.1;
const CIRCULAR_ROUTE_COUNT = 3;

/**
 * 경로 카테고리 레이블 (영어 - Redis 저장용)
 */
const CATEGORY_LABELS = {
  bikeRoad: 'bike_priority',
  shortest: 'shortest',
  fastest: 'fastest',
} as const;

/**
 * 경로 카테고리 한글 매핑 (API 응답용)
 */
export const CATEGORY_LABELS_KR: Record<string, string> = {
  bike_priority: '자전거 도로 우선',
  shortest: '최단 거리',
  fastest: '최소 시간',
} as const;

/**
 * RouteOptimizerService
 * 경로 최적화, 카테고리화, 중복 제거 및 Redis 저장 담당
 */
@Injectable()
export class RouteOptimizerService {
  private readonly logger = new Logger(RouteOptimizerService.name);
  private readonly redis: Redis;

  constructor(
    private readonly graphHopperService: GraphHopperService,
    private readonly routeUtil: RouteUtilService,
    redisService: RedisService,
  ) {
    this.redis = redisService.getOrThrow();
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * 최적 경로 검색 (두 프로필로 검색 후 최적 3개 선택)
   * @param start 출발지 좌표
   * @param end 도착지 좌표
   * @returns 카테고리별 최적 경로 3개
   */
  async findOptimalRoutes(
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
  ): Promise<CategorizedPath[]> {
    const allPaths = await this.graphHopperService.getMultipleRoutes(
      start,
      end,
    );
    return this.selectOptimalRoutes(allPaths);
  }

  /**
   * 원형 경로 검색
   * 목표 거리 ±10% 내의 경로를 최대 10회 시도하여 3개 수집 후 카테고리별로 선택
   * @param start 출발지 좌표 (도착지와 동일)
   * @param targetDistance 목표 거리 (미터)
   * @returns 카테고리별 최적 원형 경로 3개
   */
  async findOptimalCircularRoutes(
    start: { lat: number; lng: number },
    targetDistance: number,
  ): Promise<CategorizedPath[]> {
    const minDistance = targetDistance * (1 - CIRCULAR_DISTANCE_TOLERANCE);
    const maxDistance = targetDistance * (1 + CIRCULAR_DISTANCE_TOLERANCE);
    const candidatePaths: GraphHopperPath[] = [];
    let attempts = 0;

    while (
      candidatePaths.length < CIRCULAR_ROUTE_COUNT &&
      attempts < MAX_CIRCULAR_ATTEMPTS
    ) {
      const allPaths = await this.graphHopperService.getRoundTripRoutes(
        start,
        targetDistance,
      );

      for (const path of allPaths) {
        if (
          path.distance >= minDistance &&
          path.distance <= maxDistance &&
          !candidatePaths.some((p) => this.isSamePath(p, path))
        ) {
          candidatePaths.push(path);
        }
        if (candidatePaths.length >= CIRCULAR_ROUTE_COUNT) break;
      }
      attempts++;
    }

    const optimal = this.selectOptimalRoutes(candidatePaths);
    return optimal.slice(0, CIRCULAR_ROUTE_COUNT);
  }

  /**
   * 경로 ID 생성 (UUID 기반)
   * @param _path GraphHopper 경로 (사용하지 않지만 인터페이스 일관성을 위해 유지)
   * @returns UUID 문자열
   */
  public createRouteId(_path: GraphHopperPath): string {
    return randomUUID();
  }

  /**
   * Redis에 경로 데이터 저장
   * @param routeId 경로 고유 ID
   * @param data CategorizedPath 또는 RouteDto
   */
  public saveRouteToRedis(
    routeId: string,
    data: CategorizedPath | RouteDto,
  ): void {
    try {
      let dataForRedis: any;

      if ('time' in data && !('summary' in data)) {
        // CategorizedPath 타입
        dataForRedis = {
          ...data,
          time: Math.round(data.time / 1000),
          ascend:
            data.ascend !== undefined ? Math.round(data.ascend) : undefined,
          descend:
            data.descend !== undefined ? Math.round(data.descend) : undefined,
        };
        this.logger.debug(
          `Redis 저장 [CategorizedPath]: routeId=${routeId}, hasInstructions=${!!data.instructions}`,
        );
      } else if ('summary' in data) {
        // RouteDto 타입
        const route = data as RouteDto;
        dataForRedis = {
          ...route,
          summary: {
            ...route.summary,
            time: Math.round(route.summary.time / 1000),
            ascent:
              route.summary.ascent !== undefined
                ? Math.round(route.summary.ascent)
                : undefined,
            descent:
              route.summary.descent !== undefined
                ? Math.round(route.summary.descent)
                : undefined,
          },
        };
        this.logger.debug(
          `Redis 저장 [RouteDto]: routeId=${routeId}, segments=${route.segments?.length || 0}개, ` +
            `instructions=[${route.segments?.map((s) => (s.instructions ? `${s.type}:${s.instructions.length}` : `${s.type}:없음`)).join(', ')}]`,
        );
      } else {
        dataForRedis = data;
        this.logger.warn(
          `Redis 저장 [Unknown]: routeId=${routeId}, type=${typeof data}`,
        );
      }

      void this.redis.setex(
        `route:${routeId}`,
        60 * 3,
        JSON.stringify(dataForRedis),
      );
    } catch (error) {
      this.logger.error(
        `Redis 저장 실패 [routeId: ${routeId}]`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 최적 경로 선택 (카테고리별 3개)
   * @param allPaths 모든 후보 경로
   * @returns 자전거 도로 우선, 최단 거리, 최소 시간 경로 3개
   */
  private selectOptimalRoutes(allPaths: GraphHopperPath[]): CategorizedPath[] {
    if (allPaths.length === 0) return [];

    const pathsWithRatio = allPaths.map((path) => ({
      ...path,
      bikeRoadRatio: this.routeUtil.calculateBikeRoadRatio(path),
    }));

    return this.pickAndStoreCategoryRoutes(pathsWithRatio);
  }

  /**
   * 카테고리별 경로 선택 및 Redis 저장
   * @param paths 자전거 도로 비율이 계산된 경로 목록
   * @param duplicateThreshold 중복 판별 임계값
   * @returns 카테고리별 경로 (중복 제거됨)
   */
  private pickAndStoreCategoryRoutes(
    paths: Array<GraphHopperPath & { bikeRoadRatio?: number }>,
    duplicateThreshold: number = 0.01,
  ): CategorizedPath[] {
    const used: GraphHopperPath[] = [];
    const result: CategorizedPath[] = [];

    const categories: Array<{
      label: string;
      sort: (
        a: GraphHopperPath & { bikeRoadRatio?: number },
        b: GraphHopperPath & { bikeRoadRatio?: number },
      ) => number;
    }> = [
      {
        label: CATEGORY_LABELS.bikeRoad,
        sort: (a, b) => (b.bikeRoadRatio || 0) - (a.bikeRoadRatio || 0),
      },
      {
        label: CATEGORY_LABELS.shortest,
        sort: (a, b) => a.distance - b.distance,
      },
      {
        label: CATEGORY_LABELS.fastest,
        sort: (a, b) => a.time - b.time,
      },
    ];

    for (const { label, sort } of categories) {
      const sorted = [...paths].sort(sort);
      let found = sorted.find(
        (path) =>
          !used.some((p) => this.isSamePath(p, path, duplicateThreshold)),
      );

      // 중복이 모두면 첫 번째 경로 선택
      if (!found && sorted.length > 0) {
        found = sorted[0];
      }

      if (found) {
        used.push(found);
        const routeId = this.createRouteId(found);
        const categorized: CategorizedPath = {
          ...found,
          routeCategory: label,
          routeId,
        };

        // 중복이 아닐 때만 Redis 저장
        if (!result.some((r) => r.routeId === routeId)) {
          this.saveRouteToRedis(routeId, categorized);
        }

        result.push(categorized);
      }
    }

    return result;
  }

  /**
   * 두 경로 유사성 비교
   * @param path1 경로 1
   * @param path2 경로 2
   * @param _threshold 임계값 (현재 미사용)
   * @returns 유사하면 true
   */
  private isSamePath(
    path1: GraphHopperPath,
    path2: GraphHopperPath,
    _threshold = 0.01,
  ): boolean {
    return this.routeUtil.areSimilarPaths(path1, path2);
  }
}
