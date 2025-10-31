import { Injectable } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';
import { GraphHopperPath } from '../interfaces/graphhopper.interface';
import { GraphHopperService } from './graphhopper.service';
import { RouteUtilService } from './route-util.service';
import { randomUUID } from 'crypto';

/**
 * 카테고리 정보가 포함된 경로 인터페이스
 */
export interface CategorizedPath extends GraphHopperPath {
  routeCategory: string;
  bikeRoadRatio?: number;
  routeId?: string; // Redis에 저장된 전체 경로 데이터의 키
}

const MAX_CIRCULAR_ATTEMPTS = 10;
const CIRCULAR_DISTANCE_TOLERANCE = 0.1; // ±10%
const CIRCULAR_ROUTE_COUNT = 3;
const CATEGORY_LABELS = {
  bikeRoad: '자전거 도로 우선 경로',
  shortest: '최단 거리 경로',
  fastest: '최소 시간 경로',
} as const;

/**
 * RouteOptimizerService
 * - 경로 최적화, 카테고리화, 중복 제거 등
 */
@Injectable()
export class RouteOptimizerService {
  private readonly redis: Redis;
  constructor(
    private readonly graphHopperService: GraphHopperService,
    private readonly routeUtil: RouteUtilService,
    redisService: RedisService,
  ) {
    this.redis = redisService.getOrThrow();
  }

  /**
   * 두 프로필(safe_bike, fast_bike)로 경로를 검색하고 최적의 3개 경로 선택
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
   * 원형 경로 검색 (safe_bike, fast_bike 두 프로필, ±10% 거리, 최대 10회 시도, 3개 경로)
   * 목표 거리 ±10% 내의 원형 경로를 최대 10회 시도하여 3개 수집 후,
   * selectOptimalRoutes로 자전거 도로 우선/최단 거리/최소 시간 경로 반환
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
    // 후보군이 3개가 될 때까지 반복 후 selectOptimalRoutes 호출
    const optimal = this.selectOptimalRoutes(candidatePaths);
    return optimal.slice(0, CIRCULAR_ROUTE_COUNT);
  }

  /**
   * 모든 경로에서 최적의 3개 경로 선택
   * - 자전거 도로 비율이 가장 높은 경로
   * - 최단 거리 경로
   * - 최소 시간 경로
   */
  selectOptimalRoutes(allPaths: GraphHopperPath[]): CategorizedPath[] {
    if (allPaths.length === 0) return [];
    const pathsWithRatio = allPaths.map((path) => ({
      ...path,
      bikeRoadRatio: this.routeUtil.calculateBikeRoadRatio(path),
    }));
    return this.pickAndStoreCategoryRoutes(pathsWithRatio);
  }

  /**
   * 카테고리별로 중복 없는 경로 3개 추출, routeId 부여, Redis 저장까지 수행
   */
  private pickAndStoreCategoryRoutes(
    paths: Array<GraphHopperPath & { bikeRoadRatio?: number }>,
    duplicateThreshold: number = 0.01, // 중복 판별 허용 오차 (거리/시간 비율 등)
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
      const found = sorted.find(
        (path) =>
          !used.some((p) => this.isSamePath(p, path, duplicateThreshold)),
      );
      if (found) {
        used.push(found);
        const routeId = this.createRouteId(found);
        const categorized: CategorizedPath = {
          ...found,
          routeCategory: label,
          routeId,
        };
        this.saveRouteToRedis(routeId, categorized);
        result.push(categorized);
      }
    }
    return result;
  }

  /**
   * routeId 생성 책임 분리
   */
  private createRouteId(path: GraphHopperPath): string {
    // 경로 좌표, 거리, 시간, 프로필, 랜덤값 조합 (충돌 최소화)
    const base = JSON.stringify({
      c: path.points?.coordinates,
      d: path.distance,
      t: path.time,
      p: path.profile,
    });
    return (
      randomUUID() + '-' + Buffer.from(base).toString('base64url').slice(0, 16)
    );
  }

  /**
   * Redis 저장 책임 분리 (비동기, 예외 무시)
   */
  private saveRouteToRedis(routeId: string, data: CategorizedPath): void {
    try {
      void this.redis.setex(
        `route:${routeId}`,
        60 * 3, // 3분 TTL
        JSON.stringify(data),
      );
    } catch (err) {
      // 에러 로깅 (실서비스라면 logger 사용)
      // console.error(`Redis 저장 실패: routeId=${routeId}`, err);
    }
  }

  /**
   * 경로별 고유 routeId 생성 (좌표+거리+시간+랜덤)
   */
  private generateRouteId(path: GraphHopperPath): string {
    // 경로 좌표, 거리, 시간, 프로필, 랜덤값 조합 (충돌 최소화)
    const base = JSON.stringify({
      c: path.points?.coordinates,
      d: path.distance,
      t: path.time,
      p: path.profile,
    });
    return (
      randomUUID() + '-' + Buffer.from(base).toString('base64url').slice(0, 16)
    );
  }

  /**
   * 두 경로가 같은지 비교 (거리/시간 기준)
   */
  /**
   * 두 경로가 같은지 비교 (거리/시간 기준, threshold 허용)
   * @param path1
   * @param path2
   * @param threshold - 거리/시간 등 허용 오차 (기본 0.01)
   */
  private isSamePath(
    path1: GraphHopperPath,
    path2: GraphHopperPath,
    threshold = 0.01,
  ): boolean {
    return this.routeUtil.areSimilarPaths(path1, path2);
  }

  /**
   * RouteDto 등으로 변환 (예시)
   */
  private toRouteDto(path: CategorizedPath) {
    // 실제 GraphHopperPath/CategorizedPath 구조에 맞게 반환 (summary, startStation 등은 별도 변환 필요)
    return {
      routeId: path.routeId,
      routeCategory: path.routeCategory,
      bbox: path.bbox,
      distance: path.distance,
      time: path.time,
      ascend: path.ascend,
      descend: path.descend,
      points: path.points,
      profile: path.profile,
      // summary, startStation, endStation, segments 등은 실제 변환 로직에 맞게 추가 필요
    };
  }

  /**
   * 경로 좌표 해시 (중복 제거용)
   */
  private getPathHash(path: GraphHopperPath): string {
    return JSON.stringify(path.points?.coordinates);
  }

  /**
   * 다구간 경로용 - 경로들을 최적화하고 카테고리화
   */
  optimizeAndCategorizeRoutes(paths: GraphHopperPath[]): CategorizedPath[] {
    return this.selectOptimalRoutes(paths);
  }
}
