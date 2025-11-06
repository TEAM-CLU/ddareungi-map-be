import { Injectable, Logger } from '@nestjs/common';
import {
  CoordinateDto,
  RouteDto,
  RouteSegmentDto,
  BikeProfile,
} from '../../routes/dto/route.dto';
import { NavigationRouteRedis } from '../dto/navigation-route-redis.interface';

/**
 * 네비게이션 관련 헬퍼 유틸리티 서비스
 */
@Injectable()
export class NavigationHelperService {
  private readonly logger = new Logger(NavigationHelperService.name);

  /**
   * 두 좌표 간 거리 계산 (Haversine 공식)
   * @param coord1 [lng, lat] 또는 [lng, lat, elevation]
   * @param coord2 [lng, lat] 또는 [lng, lat, elevation]
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
   * 원래 경로에서 현재 위치와 가장 가까운 지점 찾기
   * @returns 가장 가까운 지점 정보 (세그먼트 인덱스, 포인트 인덱스, 좌표, 거리)
   */
  findClosestPointOnRoute(
    currentLocation: CoordinateDto,
    route: NavigationRouteRedis,
  ): {
    segmentIndex: number;
    pointIndex: number;
    coordinate: CoordinateDto;
    distance: number;
  } | null {
    let closestPoint: {
      segmentIndex: number;
      pointIndex: number;
      coordinate: CoordinateDto;
      distance: number;
    } | null = null;
    let minDistance = Infinity;

    // 모든 세그먼트의 모든 포인트를 순회하며 가장 가까운 지점 찾기
    route.segments.forEach((segment, segmentIndex) => {
      if (!segment.geometry || !segment.geometry.points) return;

      segment.geometry.points.forEach((point, pointIndex) => {
        const distance = this.calculateDistance(
          [currentLocation.lng, currentLocation.lat],
          point,
        );

        if (distance < minDistance) {
          minDistance = distance;
          closestPoint = {
            segmentIndex,
            pointIndex,
            coordinate: {
              lat: point[1],
              lng: point[0],
            },
            distance,
          };
        }
      });
    });

    return closestPoint;
  }

  /**
   * 현재 위치가 어느 세그먼트에 있는지 판단
   * 전략: 각 세그먼트의 geometry와 현재 위치 간 최단 거리 계산
   * @param currentLocation 현재 위치
   * @param route 경로 데이터
   * @returns 세그먼트 인덱스 및 타입
   */
  detectCurrentSegment(
    currentLocation: CoordinateDto,
    route: NavigationRouteRedis,
  ): { segmentIndex: number; segmentType: 'walking' | 'biking' } {
    let minDistance = Infinity;
    let closestSegmentIndex = 0;

    // 각 세그먼트의 geometry points와 현재 위치의 거리 계산
    route.segments.forEach((segment, index) => {
      if (!segment.geometry || !segment.geometry.points) return;

      // 세그먼트의 모든 포인트와 현재 위치 간 거리 계산
      segment.geometry.points.forEach((point) => {
        const distance = this.calculateDistance(
          [currentLocation.lng, currentLocation.lat],
          point,
        );

        if (distance < minDistance) {
          minDistance = distance;
          closestSegmentIndex = index;
        }
      });
    });

    const closestSegment = route.segments[closestSegmentIndex];

    this.logger.debug(
      `현재 위치에서 가장 가까운 세그먼트: ${closestSegmentIndex}번 (${closestSegment.type}), 거리: ${Math.round(minDistance)}m`,
    );

    return {
      segmentIndex: closestSegmentIndex,
      segmentType: closestSegment.type,
    };
  }

  /**
   * 원래 경로에서 특정 지점 이후의 남은 경로 추출
   * @param route 원래 경로
   * @param fromSegmentIndex 시작 세그먼트 인덱스
   * @param fromPointIndex 시작 포인트 인덱스
   * @returns 남은 경로 (RouteDto 형식)
   */
  extractRemainingRoute(
    route: NavigationRouteRedis,
    fromSegmentIndex: number,
    fromPointIndex: number,
  ): RouteDto {
    // 남은 세그먼트들 추출
    const remainingSegments = route.segments
      .slice(fromSegmentIndex)
      .map((segment, index) => {
        // 첫 번째 세그먼트는 fromPointIndex 이후만 사용
        if (index === 0 && segment.geometry && segment.geometry.points) {
          const totalPoints = segment.geometry.points.length;
          const remainingRatio = (totalPoints - fromPointIndex) / totalPoints;

          return {
            ...segment,
            geometry: {
              points: segment.geometry.points.slice(fromPointIndex),
            },
            summary: {
              ...segment.summary,
              distance: segment.summary.distance * remainingRatio,
              time: segment.summary.time * remainingRatio,
            },
            instructions: segment.instructions?.slice(
              Math.floor(
                (fromPointIndex / totalPoints) *
                  (segment.instructions?.length || 0),
              ),
            ),
          };
        }
        return segment;
      });

    // 남은 거리 및 시간 계산
    const remainingDistance = remainingSegments.reduce(
      (sum, seg) => sum + seg.summary.distance,
      0,
    );
    const remainingTime = remainingSegments.reduce(
      (sum, seg) => sum + seg.summary.time,
      0,
    );

    return {
      routeId: route.routeId,
      routeCategory: route.routeCategory,
      summary: {
        distance: remainingDistance,
        time: remainingTime,
        ascent: route.summary.ascent,
        descent: route.summary.descent,
      },
      bbox: route.bbox,
      startStation: route.startStation,
      endStation: route.endStation,
      segments: remainingSegments,
    };
  }

  /**
   * 두 경로를 병합
   * @param firstRoute 첫 번째 경로 (복귀 경로)
   * @param secondRoute 두 번째 경로 (남은 원래 경로)
   * @returns 병합된 경로
   */
  mergeRoutes(firstRoute: RouteDto, secondRoute: RouteDto): RouteDto {
    return {
      routeId: firstRoute.routeId,
      routeCategory: firstRoute.routeCategory,
      summary: {
        distance: firstRoute.summary.distance + secondRoute.summary.distance,
        time: firstRoute.summary.time + secondRoute.summary.time,
        ascent: firstRoute.summary.ascent + secondRoute.summary.ascent,
        descent: firstRoute.summary.descent + secondRoute.summary.descent,
        bikeRoadRatio: firstRoute.summary.bikeRoadRatio, // 첫 번째 경로의 값 유지
      },
      bbox: firstRoute.bbox, // 첫 번째 경로의 bbox 유지
      startStation: firstRoute.startStation,
      endStation: secondRoute.endStation || firstRoute.endStation,
      segments: [...firstRoute.segments, ...secondRoute.segments],
    };
  }

  /**
   * 다음 instruction 좌표 찾기
   * @param route 원래 경로
   * @param segmentIndex 현재 세그먼트 인덱스
   * @param pointIndex 현재 포인트 인덱스
   * @returns 다음 instruction의 좌표 및 세그먼트 타입
   */
  findNextInstructionPoint(
    route: NavigationRouteRedis,
    segmentIndex: number,
    pointIndex: number,
  ): {
    coordinate: CoordinateDto;
    segmentType: 'walking' | 'biking';
    segmentIndex: number;
    instructionIndex: number;
  } | null {
    const segment = route.segments[segmentIndex];

    if (!segment || !segment.instructions || !segment.geometry?.points) {
      this.logger.warn(`[다음 instruction] segment[${segmentIndex}] 정보 부족`);
      return null;
    }

    // 현재 세그먼트의 남은 instructions 확인
    const currentInstructions = segment.instructions;

    // pointIndex 기준으로 다음 instruction 찾기
    for (let i = 0; i < currentInstructions.length; i++) {
      const instruction = currentInstructions[i];
      const instructionPointIndex = instruction.interval?.[0] || 0;

      // 현재 위치 이후의 첫 번째 instruction
      if (instructionPointIndex > pointIndex) {
        const point = segment.geometry.points[instructionPointIndex];

        return {
          coordinate: {
            lat: point[1],
            lng: point[0],
          },
          segmentType: segment.type,
          segmentIndex,
          instructionIndex: i,
        };
      }
    }

    // 현재 세그먼트에 남은 instruction이 없으면 다음 세그먼트의 첫 instruction
    if (segmentIndex + 1 < route.segments.length) {
      const nextSegment = route.segments[segmentIndex + 1];

      if (
        nextSegment.instructions &&
        nextSegment.instructions.length > 0 &&
        nextSegment.geometry?.points
      ) {
        const firstInstruction = nextSegment.instructions[0];
        const firstInstructionPointIndex = firstInstruction.interval?.[0] || 0;
        const point = nextSegment.geometry.points[firstInstructionPointIndex];

        return {
          coordinate: {
            lat: point[1],
            lng: point[0],
          },
          segmentType: nextSegment.type,
          segmentIndex: segmentIndex + 1,
          instructionIndex: 0,
        };
      }
    }

    this.logger.warn(`[다음 instruction] 더 이상 찾을 수 없음`);
    return null;
  }

  /**
   * GraphHopper 응답을 RouteSegmentDto로 변환
   * @param ghPath GraphHopper 경로 데이터
   * @param segmentType 세그먼트 타입 (walking/biking)
   * @param profile 자전거 프로필 (biking인 경우)
   * @returns RouteSegmentDto
   */
  convertGraphHopperPathToSegment(
    ghPath: {
      distance: number;
      time: number;
      ascend: number;
      descend: number;
      points: {
        coordinates: number[][];
      };
      bbox: number[];
      instructions: Array<{
        distance: number;
        time: number;
        text: string;
        sign: number;
        interval: [number, number];
      }>;
    },
    segmentType: 'walking' | 'biking',
    profile?: 'safe_bike' | 'fast_bike',
  ): RouteSegmentDto {
    return {
      type: segmentType,
      summary: {
        distance: ghPath.distance,
        time: Math.round(ghPath.time / 1000), // ms → s
        ascent: ghPath.ascend || 0,
        descent: ghPath.descend || 0,
      },
      bbox: {
        minLat: ghPath.bbox[1],
        minLng: ghPath.bbox[0],
        maxLat: ghPath.bbox[3],
        maxLng: ghPath.bbox[2],
      },
      geometry: {
        points: ghPath.points.coordinates,
      },
      profile:
        segmentType === 'biking' && profile ? BikeProfile.SAFE_BIKE : undefined,
      instructions: ghPath.instructions.map((inst) => ({
        distance: inst.distance || 0,
        time: Math.round((inst.time || 0) / 1000), // ms → s
        text: inst.text || '',
        sign: inst.sign || 0,
        interval: inst.interval || [0, 0],
      })),
    };
  }

  /**
   * 두 세그먼트 배열을 병합
   * - 인접한 같은 타입의 세그먼트는 통합
   * - geometry points와 instructions를 올바르게 병합
   * @param segments1 첫 번째 세그먼트 배열
   * @param segments2 두 번째 세그먼트 배열
   * @returns 병합된 세그먼트 배열
   */
  mergeSegments(
    segments1: RouteSegmentDto[],
    segments2: RouteSegmentDto[],
  ): RouteSegmentDto[] {
    if (segments1.length === 0) return segments2;
    if (segments2.length === 0) return segments1;

    const lastSegment = segments1[segments1.length - 1];
    const firstSegment = segments2[0];

    // 마지막 세그먼트와 첫 세그먼트의 타입이 같으면 병합
    if (lastSegment.type === firstSegment.type) {
      const mergedSegment: RouteSegmentDto = {
        ...lastSegment,
        summary: {
          distance:
            lastSegment.summary.distance + firstSegment.summary.distance,
          time: lastSegment.summary.time + firstSegment.summary.time,
          ascent: lastSegment.summary.ascent + firstSegment.summary.ascent,
          descent: lastSegment.summary.descent + firstSegment.summary.descent,
        },
        geometry: {
          points: [
            ...lastSegment.geometry.points,
            ...firstSegment.geometry.points.slice(1), // 첫 점은 중복 제거
          ],
        },
        instructions: this.mergeInstructions(
          lastSegment.instructions || [],
          firstSegment.instructions || [],
          lastSegment.geometry.points.length - 1,
        ),
      };

      return [...segments1.slice(0, -1), mergedSegment, ...segments2.slice(1)];
    }

    // 타입이 다르면 그대로 연결
    return [...segments1, ...segments2];
  }

  /**
   * 두 instructions 배열을 병합하고 interval 조정
   * @param instructions1 첫 번째 instructions
   * @param instructions2 두 번째 instructions
   * @param offset 두 번째 instructions의 interval에 추가할 오프셋
   * @returns 병합된 instructions
   */
  private mergeInstructions(
    instructions1: Array<{
      distance: number;
      time: number;
      text: string;
      sign: number;
      interval: [number, number];
    }>,
    instructions2: Array<{
      distance: number;
      time: number;
      text: string;
      sign: number;
      interval: [number, number];
    }>,
    offset: number,
  ): Array<{
    distance: number;
    time: number;
    text: string;
    sign: number;
    interval: [number, number];
  }> {
    // 두 번째 instructions는 interval 조정
    const adjusted = instructions2.map((inst) => ({
      ...inst,
      interval: [inst.interval[0] + offset, inst.interval[1] + offset] as [
        number,
        number,
      ],
    }));

    return [...instructions1, ...adjusted];
  }
}
