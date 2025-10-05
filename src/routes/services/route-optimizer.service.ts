import { Injectable } from '@nestjs/common';
import { GraphHopperPath } from '../interfaces/graphhopper.interface';
import { GraphHopperService } from './graphhopper.service';

// 카테고리 정보가 포함된 경로 인터페이스
export interface CategorizedPath extends GraphHopperPath {
  routeCategory: string;
  bikeRoadRatio?: number;
}

@Injectable()
export class RouteOptimizerService {
  constructor(private readonly graphHopperService: GraphHopperService) {}

  /**
   * 두 프로필(safe_bike, fast_bike)로 경로를 검색하고 최적의 3개 경로 선택
   */
  async findOptimalRoutes(
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
  ): Promise<CategorizedPath[]> {
    // GraphHopperService를 통해 safe_bike와 fast_bike 프로필로 경로 검색
    const allPaths = await this.graphHopperService.getMultipleRoutes(
      start,
      end,
    );
    return this.selectOptimalRoutes(allPaths);
  }

  /**
   * 원형 경로 검색 (safe_bike, fast_bike 두 프로필)
   */
  async findOptimalCircularRoutes(
    start: { lat: number; lng: number },
    targetDistance: number,
  ): Promise<CategorizedPath[]> {
    // GraphHopperService를 통해 safe_bike와 fast_bike 프로필로 원형 경로 검색
    const allPaths = await this.graphHopperService.getRoundTripRoutes(
      start,
      targetDistance,
    );
    return this.selectOptimalRoutes(allPaths);
  }

  /**
   * 모든 경로에서 최적의 3개 경로 선택
   * - 자전거 도로 비율이 가장 높은 경로
   * - 최단 거리 경로
   * - 최소 시간 경로
   */
  selectOptimalRoutes(allPaths: GraphHopperPath[]): CategorizedPath[] {
    if (allPaths.length === 0) return [];

    // 모든 경로에 자전거 도로 비율 계산
    const pathsWithRatio = allPaths.map((path) => ({
      ...path,
      bikeRoadRatio: this.calculateBikeRoadRatio(path),
    }));

    // 1. 자전거 도로 비율이 가장 높은 경로
    const highestBikeRoadPath = pathsWithRatio.reduce((prev, current) =>
      (prev.bikeRoadRatio || 0) > (current.bikeRoadRatio || 0) ? prev : current,
    );

    // 2. 최단 거리 경로
    const shortestDistancePath = pathsWithRatio.reduce((prev, current) =>
      prev.distance < current.distance ? prev : current,
    );

    // 3. 최소 시간 경로
    const shortestTimePath = pathsWithRatio.reduce((prev, current) =>
      prev.time < current.time ? prev : current,
    );

    // 카테고리 정보 추가
    const categorizedPaths: CategorizedPath[] = [];

    // 자전거 도로 우선 경로 추가
    categorizedPaths.push({
      ...highestBikeRoadPath,
      routeCategory: '자전거 도로 우선 경로',
    });

    // 최단 거리 경로 추가 (중복이 아닌 경우)
    if (!this.isSamePath(shortestDistancePath, highestBikeRoadPath)) {
      categorizedPaths.push({
        ...shortestDistancePath,
        routeCategory: '최단 거리 경로',
      });
    }

    // 최소 시간 경로 추가 (중복이 아닌 경우)
    if (
      !this.isSamePath(shortestTimePath, highestBikeRoadPath) &&
      !this.isSamePath(shortestTimePath, shortestDistancePath)
    ) {
      categorizedPaths.push({
        ...shortestTimePath,
        routeCategory: '최소 시간 경로',
      });
    }

    return categorizedPaths;
  }

  /**
   * 두 경로가 같은지 비교
   */
  private isSamePath(path1: GraphHopperPath, path2: GraphHopperPath): boolean {
    return (
      Math.abs(path1.distance - path2.distance) < 10 && // 10m 오차 허용
      Math.abs(path1.time - path2.time) < 5000 // 5초 오차 허용
    );
  }

  /**
   * 자전거 도로 비율 계산
   */
  calculateBikeRoadRatio(path: GraphHopperPath): number {
    if (
      !path.details ||
      !path.details.road_class ||
      !path.points?.coordinates
    ) {
      return 0;
    }

    let bikeRoadDistance = 0;
    const totalDistance = path.distance;
    const points = path.points.coordinates;

    // 각 좌표 인덱스까지의 누적 거리를 미리 계산 (성능 최적화)
    const cumulativeDistances: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      const prevDistance = cumulativeDistances[i - 1];
      const segmentDist = this.getDistance(points[i - 1], points[i]);
      cumulativeDistances.push(prevDistance + segmentDist);
    }

    // road_class 세부 정보에서 자전거 도로 구간의 실제 거리를 계산
    path.details.road_class.forEach((detail) => {
      const startIndex = detail[0];
      const endIndex = detail[1];
      const roadClass = detail[2];

      // 누적 거리를 이용해 구간의 실제 거리를 정확하게 계산
      const segmentDistance =
        cumulativeDistances[endIndex] - cumulativeDistances[startIndex];

      // 자전거 친화적 도로 유형 확장
      if (
        roadClass === 'cycleway' ||
        roadClass === 'path' ||
        roadClass === 'track' ||
        roadClass === 'living_street' ||
        roadClass === 'service' ||
        roadClass === 'residential'
      ) {
        bikeRoadDistance += segmentDistance;
      }
    });

    // bike_network 정보가 있는 경우 추가로 확인
    if (path.details.bike_network) {
      path.details.bike_network.forEach((detail) => {
        const startIndex = detail[0];
        const endIndex = detail[1];
        const bikeNetwork = detail[2];

        // 누적 거리를 이용해 구간의 실제 거리를 정확하게 계산
        const segmentDistance =
          cumulativeDistances[endIndex] - cumulativeDistances[startIndex];

        // bike_network가 'missing'이 아닌 경우 공식 자전거 도로로 간주
        // 이미 road_class로 계산된 구간과 중복될 수 있으므로 별도 처리 필요
        if (bikeNetwork && bikeNetwork !== 'missing') {
          // 이 구간이 이미 road_class에서 자전거 도로로 분류되었는지 확인
          const isAlreadyCounted = path.details?.road_class?.some(
            (roadDetail) => {
              const roadStart = roadDetail[0];
              const roadEnd = roadDetail[1];
              const roadClass = roadDetail[2];

              // 구간이 겹치고 이미 자전거 도로로 분류된 경우
              return (
                roadStart <= startIndex &&
                roadEnd >= endIndex &&
                (roadClass === 'cycleway' ||
                  roadClass === 'path' ||
                  roadClass === 'track' ||
                  roadClass === 'living_street' ||
                  roadClass === 'service' ||
                  roadClass === 'residential')
              );
            },
          );

          // 중복 계산을 피하기 위해 아직 계산되지 않은 구간만 추가
          if (!isAlreadyCounted) {
            bikeRoadDistance += segmentDistance;
          }
        }
      });
    }

    if (totalDistance === 0) return 0;

    // 실제 총 거리와 계산된 자전거 도로 거리의 비율을 반환
    // totalDistance가 더 정확하므로 분모로 사용합니다.
    const ratio = (bikeRoadDistance / totalDistance) * 100;
    return Math.min(ratio, 100); // 간혹 계산 오차로 100을 넘는 경우 방지
  }

  /**
   * 위도, 경도 좌표 두 개 사이의 거리를 미터(m) 단위로 계산하는 헬퍼 함수 (Haversine 공식)
   */
  private getDistance(coord1: number[], coord2: number[]): number {
    const R = 6371e3; // 지구 반지름 (미터)
    const lat1 = (coord1[1] * Math.PI) / 180;
    const lat2 = (coord2[1] * Math.PI) / 180;
    const deltaLat = ((coord2[1] - coord1[1]) * Math.PI) / 180;
    const deltaLng = ((coord2[0] - coord1[0]) * Math.PI) / 180;

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(deltaLng / 2) *
        Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }
}
