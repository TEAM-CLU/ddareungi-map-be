import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';
import {
  CoordinateDto,
  RouteDto,
  RouteSegmentDto,
  BikeProfile,
  InstructionDto,
} from '../../routes/dto/route.dto';
import { NavigationRouteRedis } from '../dto/navigation-route-redis.interface';
import { TtsService } from '../../tts/tts.service';
import { TranslationService } from '../../tts/translation.service';

/**
 * 네비게이션 상수
 */
export const NAVIGATION_SESSION_TTL = 600; // 10분

export const REDIS_KEY_PREFIX = {
  SESSION: 'navigation:session:',
  ROUTE: 'route:',
} as const;

export const NAVIGATION_ERRORS = {
  SESSION_NOT_FOUND: '세션을 찾을 수 없습니다.',
  ROUTE_NOT_FOUND: '경로 데이터를 찾을 수 없습니다.',
  INVALID_SESSION_DATA: '세션 데이터가 유효하지 않습니다.',
} as const;

/**
 * 네비게이션 관련 헬퍼 유틸리티 서비스
 */
@Injectable()
export class NavigationHelperService {
  private readonly logger = new Logger(NavigationHelperService.name);
  public readonly redis: Redis;

  constructor(
    redisService: RedisService,
    private readonly ttsService: TtsService,
    private readonly translationService: TranslationService,
  ) {
    this.redis = redisService.getOrThrow();
  }

  /**
   * Instructions에 TTS URL과 다음 회전 좌표 추가
   * - 책임: TTS 음성 합성 및 트리거 좌표 계산
   * - 권한: TtsService를 통한 배치 합성
   * - 특수 처리: 도착 instruction (interval 동일)의 경우 endIdx 좌표 사용
   */
  async addTtsToInstructions(
    instructions: InstructionDto[],
    coordinates: number[][],
  ): Promise<InstructionDto[]> {
    if (instructions.length === 0) {
      return instructions;
    }

    this.logger.log(`TTS 합성 시작: ${instructions.length}개의 인스트럭션`);
    const ttsResults = await this.ttsService.batchSynthesize(
      instructions,
      'ko-KR',
    );

    return instructions.map((instruction) => {
      const originalText = instruction.text;
      const ttsResult = ttsResults.get(originalText);
      const textKo =
        ttsResult?.textKo ??
        this.translationService.translateToKorean(originalText);

      // 다음 회전 좌표 계산 로직
      let nextTurnCoordinate: { lat: number; lng: number } | undefined;
      const [startIdx, endIdx] = instruction.interval;

      // interval 유효성 검증
      if (startIdx < 0 || endIdx >= coordinates.length) {
        this.logger.warn(
          `Invalid interval [${startIdx}, ${endIdx}] for coordinates.length=${coordinates.length}`,
        );
        return {
          ...instruction,
          text: textKo,
          nextTurnCoordinate,
          ttsUrl: ttsResult?.url,
        };
      }

      let triggerIdx: number;

      if (startIdx === endIdx) {
        // 케이스 1: 도착 instruction (목적지/경유지 도착)
        // interval이 [1, 1] 같이 동일한 경우 -> endIdx 좌표 사용
        triggerIdx = endIdx;
        this.logger.debug(
          `도착 instruction: interval=[${startIdx}, ${endIdx}], triggerIdx=${triggerIdx}`,
        );
      } else if (endIdx > startIdx) {
        // 케이스 2: 일반 instruction
        // interval의 마지막에서 두 번째 좌표 사용 (endIdx - 1)
        triggerIdx = endIdx - 1;
      } else {
        // 케이스 3: 비정상 (startIdx > endIdx)
        this.logger.warn(
          `Abnormal interval [${startIdx}, ${endIdx}], using startIdx`,
        );
        triggerIdx = startIdx;
      }

      // 좌표 추출
      const triggerPoint = coordinates[triggerIdx];
      if (triggerPoint && triggerPoint.length >= 2) {
        nextTurnCoordinate = {
          lat: triggerPoint[1], // [lng, lat] 형식
          lng: triggerPoint[0],
        };
      } else {
        this.logger.warn(
          `Invalid coordinate at index ${triggerIdx}: ${JSON.stringify(triggerPoint)}`,
        );
      }

      return {
        ...instruction,
        text: textKo,
        nextTurnCoordinate,
        ttsUrl: ttsResult?.url,
      };
    });
  }

  // ============================================================================
  // Redis 헬퍼 함수
  // ============================================================================

  /**
   * 세션 데이터 조회
   * @param sessionId 세션 ID
   * @returns 세션 데이터
   * @throws NotFoundException 세션을 찾을 수 없는 경우
   */
  async getSessionData(sessionId: string): Promise<{
    routeId: string;
    route: NavigationRouteRedis;
  }> {
    const sessionKey = `${REDIS_KEY_PREFIX.SESSION}${sessionId}`;
    const sessionJson = await this.redis.get(sessionKey);

    if (!sessionJson) {
      this.logger.warn(`세션 조회 실패: ${sessionId}`);
      throw new NotFoundException(NAVIGATION_ERRORS.SESSION_NOT_FOUND);
    }

    try {
      return JSON.parse(sessionJson) as {
        routeId: string;
        route: NavigationRouteRedis;
      };
    } catch (error) {
      this.logger.error(`세션 데이터 파싱 실패: ${sessionId}`, error);
      throw new InternalServerErrorException(
        NAVIGATION_ERRORS.INVALID_SESSION_DATA,
      );
    }
  }

  /**
   * 경로 데이터 조회
   * @param routeId 경로 ID
   * @returns 경로 데이터
   * @throws NotFoundException 경로를 찾을 수 없는 경우
   */
  async getRouteData(routeId: string): Promise<NavigationRouteRedis> {
    const routeKey = `${REDIS_KEY_PREFIX.ROUTE}${routeId}`;
    const routeJson = await this.redis.get(routeKey);

    if (!routeJson) {
      this.logger.warn(`경로 조회 실패: ${routeId}`);
      throw new NotFoundException(NAVIGATION_ERRORS.ROUTE_NOT_FOUND);
    }

    try {
      return JSON.parse(routeJson) as NavigationRouteRedis;
    } catch (error) {
      this.logger.error(`경로 데이터 파싱 실패: ${routeId}`, error);
      throw new InternalServerErrorException(
        NAVIGATION_ERRORS.INVALID_SESSION_DATA,
      );
    }
  }

  /**
   * 세션 TTL 갱신
   * @param sessionId 세션 ID
   * @param routeId 경로 ID (선택사항)
   */
  async refreshSessionTTL(sessionId: string, routeId?: string): Promise<void> {
    const sessionKey = `${REDIS_KEY_PREFIX.SESSION}${sessionId}`;
    const promises = [this.redis.expire(sessionKey, NAVIGATION_SESSION_TTL)];

    if (routeId) {
      promises.push(
        this.redis.expire(
          `${REDIS_KEY_PREFIX.ROUTE}${routeId}`,
          NAVIGATION_SESSION_TTL,
        ),
      );
    }

    await Promise.all(promises);

    this.logger.debug(
      `TTL 갱신 완료: sessionId=${sessionId}, routeId=${routeId || 'N/A'}, ttl=${NAVIGATION_SESSION_TTL}초`,
    );
  }

  // ============================================================================
  // 거리 및 좌표 계산
  // ============================================================================

  /**
   * Segments와 Instructions의 거리/시간 반올림
   * - 거리: 미터 단위로 반올림
   * - 시간: 초 단위로 반올림
   * @param segments 세그먼트 배열
   * @returns 반올림된 세그먼트 배열
   */
  normalizeSegments(segments: RouteSegmentDto[]): RouteSegmentDto[] {
    return segments.map((segment) => ({
      ...segment,
      summary: {
        ...segment.summary,
        distance: Math.round(segment.summary.distance),
        time: Math.round(segment.summary.time),
        ascent: segment.summary.ascent
          ? Math.round(segment.summary.ascent)
          : segment.summary.ascent,
        descent: segment.summary.descent
          ? Math.round(segment.summary.descent)
          : segment.summary.descent,
      },
      instructions: segment.instructions?.map((inst) => ({
        ...inst,
        distance: Math.round(inst.distance),
        time: Math.round(inst.time),
      })),
    }));
  }

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
    // 필드 순서 보장: type → profile → summary → bbox → geometry → instructions
    const segment: RouteSegmentDto = {
      type: segmentType,
      ...(segmentType === 'biking' && {
        profile:
          profile === BikeProfile.FAST_BIKE
            ? ('fast_bike' as const)
            : ('safe_bike' as const),
      }),
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
      instructions: ghPath.instructions.map((inst) => ({
        distance: inst.distance || 0,
        time: Math.round((inst.time || 0) / 1000), // ms → s
        text: inst.text || '',
        sign: inst.sign || 0,
        interval: inst.interval || [0, 0],
      })),
    };

    return segment;
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
      // 필드 순서 보장: type → profile → summary → bbox → geometry → instructions
      const mergedSegment: RouteSegmentDto = {
        type: lastSegment.type,
        ...(lastSegment.profile && { profile: lastSegment.profile }),
        summary: {
          distance:
            lastSegment.summary.distance + firstSegment.summary.distance,
          time: lastSegment.summary.time + firstSegment.summary.time,
          ascent: lastSegment.summary.ascent + firstSegment.summary.ascent,
          descent: lastSegment.summary.descent + firstSegment.summary.descent,
        },
        bbox: lastSegment.bbox,
        geometry: {
          points: [
            ...(lastSegment.geometry?.points || []),
            ...(firstSegment.geometry?.points.slice(1) || []), // 첫 점은 중복 제거
          ],
        },
        instructions: this.mergeInstructions(
          lastSegment.instructions || [],
          firstSegment.instructions || [],
          (lastSegment.geometry?.points.length || 1) - 1,
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

  /**
   * 원래 경로에서 대여소 정보 추출
   * @param route 원래 경로 정보 (Redis에 저장된)
   * @returns 시작/종료 대여소 정보 (있는 경우)
   */
  extractStationInfo(route: NavigationRouteRedis): {
    startStation?: {
      stationId: string;
      stationName: string;
      location: CoordinateDto;
    };
    endStation?: {
      stationId: string;
      stationName: string;
      location: CoordinateDto;
    };
  } {
    const result: {
      startStation?: {
        stationId: string;
        stationName: string;
        location: CoordinateDto;
      };
      endStation?: {
        stationId: string;
        stationName: string;
        location: CoordinateDto;
      };
    } = {};

    // 원래 경로에서 대여소 정보 가져오기
    if (route.startStation) {
      result.startStation = {
        stationId: route.startStation.number,
        stationName: route.startStation.name,
        location: {
          lat: route.startStation.lat,
          lng: route.startStation.lng,
        },
      };
    }

    if (route.endStation) {
      result.endStation = {
        stationId: route.endStation.number,
        stationName: route.endStation.name,
        location: {
          lat: route.endStation.lat,
          lng: route.endStation.lng,
        },
      };
    }

    return result;
  }

  /**
   * 세그먼트 배열의 총합 계산
   * @param segments 세그먼트 배열
   * @returns 거리/시간/경사의 총합
   */
  calculateTotalSummary(segments: RouteSegmentDto[]): {
    distance: number;
    time: number;
    ascent: number;
    descent: number;
  } {
    return segments.reduce(
      (total, segment) => ({
        distance: total.distance + segment.summary.distance,
        time: total.time + segment.summary.time,
        ascent: total.ascent + segment.summary.ascent,
        descent: total.descent + segment.summary.descent,
      }),
      { distance: 0, time: 0, ascent: 0, descent: 0 },
    );
  }

  /**
   * 세그먼트 배열의 경계 박스 계산
   * @param segments 세그먼트 배열
   * @returns 경계 박스
   */
  calculateBoundingBox(segments: RouteSegmentDto[]): {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    for (const segment of segments) {
      if (segment.geometry && segment.geometry.points) {
        for (const point of segment.geometry.points) {
          const [lng, lat] = point;
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
        }
      }
    }

    return { minLat, maxLat, minLng, maxLng };
  }

  /**
   * 고도 데이터 제거 (geometry points에서 3번째 값 제거)
   * @param segments 세그먼트 배열
   * @returns 고도가 제거된 세그먼트 배열
   */
  removeElevationFromSegments(segments: RouteSegmentDto[]): RouteSegmentDto[] {
    return segments.map((segment) => ({
      ...segment,
      geometry: segment.geometry
        ? {
            points: segment.geometry.points.map(([lng, lat]) => [lng, lat]),
          }
        : undefined,
    }));
  }

  /**
   * 경유지를 경로 좌표로 변환
   * @param waypoints 경유지 좌표 배열
   * @returns 경로 좌표 형식 배열 (고도 없음)
   */
  convertWaypointsToPathCoordinates(
    waypoints: CoordinateDto[],
  ): [number, number][] {
    return waypoints.map((wp) => [wp.lng, wp.lat]);
  }

  /**
   * 세그먼트 배열에서 모든 좌표를 통합하여 추출
   * @param segments 세그먼트 배열
   * @returns 통합된 좌표 배열 ([lng, lat] 형식)
   */
  extractCoordinatesFromSegments(
    segments: RouteSegmentDto[],
  ): [number, number][] {
    const coordinates: [number, number][] = [];

    for (const segment of segments) {
      if (segment.geometry && segment.geometry.points) {
        for (const point of segment.geometry.points) {
          // [lng, lat] 또는 [lng, lat, elevation] 형식 지원
          const [lng, lat] = point;
          coordinates.push([lng, lat]);
        }
      }
    }

    return coordinates;
  }

  /**
   * 세그먼트 배열에서 모든 인스트럭션을 통합하여 추출
   * - 중요: interval을 통합 좌표 배열 기준으로 오프셋 조정
   * @param segments 세그먼트 배열
   * @returns 통합된 인스트럭션 배열 (interval이 전체 좌표 배열 기준)
   */
  extractInstructionsFromSegments(
    segments: RouteSegmentDto[],
  ): InstructionDto[] {
    const instructions: InstructionDto[] = [];
    let coordinateOffset = 0; // 현재까지 누적된 좌표 개수

    for (const segment of segments) {
      // 현재 세그먼트의 좌표 개수 계산
      const segmentCoordinateCount = segment.geometry?.points?.length || 0;

      if (segment.instructions && segment.instructions.length > 0) {
        // interval을 전체 좌표 배열 기준으로 조정
        const adjustedInstructions = segment.instructions.map((inst) => ({
          ...inst,
          interval: [
            inst.interval[0] + coordinateOffset,
            inst.interval[1] + coordinateOffset,
          ] as [number, number],
        }));

        instructions.push(...adjustedInstructions);
      }

      // 다음 세그먼트를 위해 오프셋 업데이트
      coordinateOffset += segmentCoordinateCount;
    }

    return instructions;
  }

  /**
   * 세그먼트에서 geometry 제거 (클라이언트 응답용)
   * @param segments 세그먼트 배열
   * @returns geometry가 제거된 세그먼트 배열
   */
  removeGeometryFromSegments(
    segments: RouteSegmentDto[],
  ): Omit<RouteSegmentDto, 'geometry'>[] {
    return segments.map((segment) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { geometry, ...segmentWithoutGeometry } = segment;
      return segmentWithoutGeometry;
    });
  }

  /**
   * 세그먼트에서 geometry와 instructions 제거 (클라이언트 응답용)
   * @param segments 세그먼트 배열
   * @returns geometry와 instructions가 제거된 세그먼트 배열
   */
  removeGeometryAndInstructionsFromSegments(
    segments: RouteSegmentDto[],
  ): Omit<RouteSegmentDto, 'geometry' | 'instructions'>[] {
    return segments.map((segment) => {
      const {
        geometry: _geometry,
        instructions: _instructions,
        ...segmentWithoutGeometryAndInstructions
      } = segment;
      return segmentWithoutGeometryAndInstructions;
    });
  }
}
