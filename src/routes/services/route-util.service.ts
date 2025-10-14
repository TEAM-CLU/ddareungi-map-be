import { Injectable } from '@nestjs/common';
import { GraphHopperPath } from '../interfaces/graphhopper.interface';

/**
 * RouteUtilService
 * - 경로 계산, 분석, 변환에 필요한 공통 헬퍼 함수 제공
 */
@Injectable()
export class RouteUtilService {
  private static readonly BIKE_ROAD_CLASSES = [
    'cycleway',
    'path',
    'track',
    'living_street',
    'service',
    'residential',
  ];
  /**
   * 여러 경로 세그먼트의 전체 자전거 도로 비율 계산
   * @param segments RouteSegmentDto[]
   * @returns 전체 자전거 도로 비율 (0~1)
   */
  /**
   * 여러 경로 세그먼트의 전체 자전거 도로 비율 계산
   */
  public calculateOverallBikeRoadRatio(
    segments: import('../dto/route.dto').RouteSegmentDto[],
  ): number {
    let totalBikeDistance = 0;
    let totalBikeRoadDistance = 0;
    for (const segment of segments) {
      totalBikeDistance += segment.summary.distance;
      if (segment.summary.bikeRoadRatio) {
        totalBikeRoadDistance +=
          segment.summary.distance * segment.summary.bikeRoadRatio;
      }
    }
    return totalBikeDistance > 0
      ? Math.round((totalBikeRoadDistance / totalBikeDistance) * 100) / 100
      : 0;
  }
  /**
   * 고도 배열에 이동평균(Moving Average) 스무딩 적용
   * @param elevations 고도값 배열
   * @param windowSize 이동평균 윈도우 크기
   */
  /**
   * 고도 배열에 이동평균(Moving Average) 스무딩 적용
   */
  public smoothElevations(
    elevations: number[],
    windowSize: number = 5,
  ): number[] {
    if (windowSize < 2) return elevations;
    const smoothed: number[] = [];
    for (let i = 0; i < elevations.length; i++) {
      let sum = 0;
      let count = 0;
      for (
        let j = Math.max(0, i - Math.floor(windowSize / 2));
        j <= Math.min(elevations.length - 1, i + Math.floor(windowSize / 2));
        j++
      ) {
        sum += elevations[j];
        count++;
      }
      smoothed.push(sum / count);
    }
    return smoothed;
  }
  /**
   * 자전거 도로 비율 계산
   * GraphHopper의 상세 정보를 이용해 정확한 자전거 도로 비율을 계산
   */
  /**
   * 자전거 도로 비율 계산 (GraphHopper 상세 정보 기반)
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
    // 누적 거리 계산
    const cumulativeDistances: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      const prevDistance = cumulativeDistances[i - 1];
      const segmentDist = this.calculateDistance(points[i - 1], points[i]);
      cumulativeDistances.push(prevDistance + segmentDist);
    }
    // road_class 세부 정보에서 자전거 도로 구간의 실제 거리를 계산
    for (const detail of path.details.road_class) {
      const [startIndex, endIndex, roadClass] = detail;
      const segmentDistance =
        cumulativeDistances[endIndex] - cumulativeDistances[startIndex];
      if (RouteUtilService.BIKE_ROAD_CLASSES.includes(roadClass)) {
        bikeRoadDistance += segmentDistance;
      }
    }
    // bike_network 정보가 있는 경우 추가로 확인
    if (path.details.bike_network) {
      for (const detail of path.details.bike_network) {
        const [startIndex, endIndex, bikeNetwork] = detail;
        const segmentDistance =
          cumulativeDistances[endIndex] - cumulativeDistances[startIndex];
        if (bikeNetwork && bikeNetwork !== 'missing') {
          // 이미 road_class에서 자전거 도로로 분류된 구간인지 확인
          const isAlreadyCounted = path.details.road_class.some(
            (roadDetail) => {
              const [roadStart, roadEnd, roadClass] = roadDetail;
              return (
                roadStart <= startIndex &&
                roadEnd >= endIndex &&
                RouteUtilService.BIKE_ROAD_CLASSES.includes(roadClass)
              );
            },
          );
          if (!isAlreadyCounted) {
            bikeRoadDistance += segmentDistance;
          }
        }
      }
    }
    if (totalDistance === 0) return 0;
    const ratio = (bikeRoadDistance / totalDistance) * 100;
    return Math.min(ratio, 100);
  }

  /**
   * 두 좌표 간의 거리 계산 (Haversine 공식)
   * @param coord1 첫 번째 좌표 [lng, lat]
   * @param coord2 두 번째 좌표 [lng, lat]
   * @returns 거리 (미터)
   */
  calculateDistance(coord1: number[], coord2: number[]): number {
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

  /**
   * 경로들의 전체 경계 상자(Bounding Box) 계산
   * @param paths GraphHopper 경로 배열
   * @returns 전체 경로를 포함하는 경계 상자
   */
  calculateOverallBounds(paths: GraphHopperPath[]): {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
  } {
    const allPoints: number[][] = [];

    // 모든 경로의 좌표점을 수집
    paths.forEach((path) => {
      if (path.points && path.points.coordinates) {
        allPoints.push(...path.points.coordinates);
      }
    });

    if (allPoints.length === 0) {
      return {
        minLat: 0,
        minLng: 0,
        maxLat: 0,
        maxLng: 0,
      };
    }

    // 모든 좌표점에서 최소/최대 lat, lng 찾기
    const lngs = allPoints.map((point) => point[0]); // longitude
    const lats = allPoints.map((point) => point[1]); // latitude

    return {
      minLng: Math.min(...lngs),
      minLat: Math.min(...lats),
      maxLng: Math.max(...lngs),
      maxLat: Math.max(...lats),
    };
  }

  /**
   * 두 경로가 유사한지 비교 (거리와 시간 기준)
   * @param path1 첫 번째 경로
   * @param path2 두 번째 경로
   * @returns 유사한 경로인지 여부
   */
  areSimilarPaths(path1: GraphHopperPath, path2: GraphHopperPath): boolean {
    return (
      Math.abs(path1.distance - path2.distance) < 10 && // 10m 오차 허용
      Math.abs(path1.time - path2.time) < 5000 // 5초 오차 허용
    );
  }

  /**
   * 경로의 최대 오르막/내리막 경사도를 슬라이딩 윈도우 방식으로 계산합니다.
   * @param path GraphHopper 경로 객체
   * @returns { maxUphill: number, maxDownhill: number }
   */
  calculateMaxGradients(path: GraphHopperPath): {
    maxUphill: number;
    maxDownhill: number;
  } {
    if (!path.points?.coordinates || path.points.coordinates.length < 2) {
      return { maxUphill: 0, maxDownhill: 0 };
    }

    const coordinates = path.points.coordinates;
    // 고도값만 추출 후 스무딩 적용
    const elevations = coordinates.map((c) => c[2] || 0);
    const smoothedElevations = this.smoothElevations(elevations, 5);
    let maxUphill = 0;
    let maxDownhill = 0;
    const MIN_SEGMENT_DISTANCE = 10; // 최소 구간 거리 (미터)
    const MAX_GRADIENT = 15; // 현실적 상한선(%) 더 낮게

    const window: { idx: number; dist: number }[] = [];
    let currentDistance = 0;

    for (let i = 1; i < coordinates.length; i++) {
      const dist = this.calculateDistance(coordinates[i - 1], coordinates[i]);
      window.push({ idx: i - 1, dist });
      currentDistance += dist;

      // 윈도우의 총 거리가 최소 거리를 넘으면 경사도 계산 시작
      while (currentDistance >= MIN_SEGMENT_DISTANCE && window.length > 1) {
        const startIdx = window[0].idx;
        const endIdx = i;
        const elevationDiff =
          smoothedElevations[endIdx] - smoothedElevations[startIdx];

        // 2. 정확한 수평 거리 계산
        const horizontalDistance = Math.sqrt(
          Math.max(
            Math.pow(currentDistance, 2) - Math.pow(elevationDiff, 2),
            0,
          ),
        );
        if (horizontalDistance > 0) {
          const gradient = (elevationDiff / horizontalDistance) * 100;
          // 3. 오르막/내리막 구분, 현실적 상한선 적용
          if (gradient > 0 && gradient <= MAX_GRADIENT) {
            maxUphill = Math.max(maxUphill, gradient);
          } else if (gradient < 0 && Math.abs(gradient) <= MAX_GRADIENT) {
            maxDownhill = Math.max(maxDownhill, Math.abs(gradient));
          }
        }
        // 윈도우의 맨 앞 요소를 제거하여 윈도우를 한 칸 이동
        const removed = window.shift();
        if (removed) {
          currentDistance -= removed.dist;
        }
      }
    }
    return {
      maxUphill: Math.round(maxUphill * 10) / 10, // 소수점 첫째자리
      maxDownhill: Math.round(maxDownhill * 10) / 10,
    };
  }

  /**
   * 기존 calculateMaxGradient와의 호환성을 위해 오르막만 반환
   */
  calculateMaxGradient(path: GraphHopperPath): number {
    return this.calculateMaxGradients(path).maxUphill;
  }

  /**
   * 경로의 평균 경사도 계산 (참고용 - 최대 경사도가 더 유용)
   * @param path GraphHopper 경로
   * @returns 평균 경사도 (%)
   */
  calculateAverageGradient(path: GraphHopperPath): number {
    if (path.distance === 0) return 0;

    const elevationChange = Math.abs(path.ascend - path.descend);
    const gradient = (elevationChange / path.distance) * 100;

    return Math.round(gradient * 100) / 100; // 소수점 둘째자리까지
  }
}
