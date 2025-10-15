import { Injectable } from '@nestjs/common';
import { GraphHopperPath } from '../interfaces/graphhopper.interface';
import { GraphHopperService } from './graphhopper.service';
import { RouteUtilService } from './route-util.service';

/**
 * 카테고리 정보가 포함된 경로 인터페이스
 */
export interface CategorizedPath extends GraphHopperPath {
  routeCategory: string;
  bikeRoadRatio?: number;
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
  constructor(
    private readonly graphHopperService: GraphHopperService,
    private readonly routeUtil: RouteUtilService,
  ) {}

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
    // 카테고리별 정렬
    const bikeRoadSorted = [...pathsWithRatio].sort(
      (a, b) => (b.bikeRoadRatio || 0) - (a.bikeRoadRatio || 0),
    );
    const shortestSorted = [...pathsWithRatio].sort(
      (a, b) => a.distance - b.distance,
    );
    const fastestSorted = [...pathsWithRatio].sort((a, b) => a.time - b.time);

    // 카테고리별 실제 경로와 라벨을 정확히 매칭해서 반환
    const used: GraphHopperPath[] = [];
    let bikeRoadPath: GraphHopperPath | undefined;
    let shortestPath: GraphHopperPath | undefined;
    let fastestPath: GraphHopperPath | undefined;

    for (const path of bikeRoadSorted) {
      if (!used.some((p) => this.isSamePath(p, path))) {
        bikeRoadPath = path;
        used.push(path);
        break;
      }
    }
    for (const path of shortestSorted) {
      if (!used.some((p) => this.isSamePath(p, path))) {
        shortestPath = path;
        used.push(path);
        break;
      }
    }
    for (const path of fastestSorted) {
      if (!used.some((p) => this.isSamePath(p, path))) {
        fastestPath = path;
        used.push(path);
        break;
      }
    }
    const result: CategorizedPath[] = [];
    if (bikeRoadPath)
      result.push({ ...bikeRoadPath, routeCategory: CATEGORY_LABELS.bikeRoad });
    if (shortestPath)
      result.push({ ...shortestPath, routeCategory: CATEGORY_LABELS.shortest });
    if (fastestPath)
      result.push({ ...fastestPath, routeCategory: CATEGORY_LABELS.fastest });
    return result;
  }

  /**
   * 두 경로가 같은지 비교 (거리/시간 기준)
   */
  private isSamePath(path1: GraphHopperPath, path2: GraphHopperPath): boolean {
    return this.routeUtil.areSimilarPaths(path1, path2);
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
