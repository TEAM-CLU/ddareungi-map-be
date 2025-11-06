import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';
import {
  CoordinateDto,
  RouteDto,
  RouteSegmentDto,
  InstructionDto,
} from '../../routes/dto/route.dto';
import { RoutesService } from '../../routes/routes.service';
import { NavigationRouteRedis } from '../dto/navigation-route-redis.interface';
import { FullRerouteResponseDto } from '../dto/navigation.dto';
import { NavigationHelperService } from './navigation-helper.service';

/**
 * 네비게이션 세션 TTL (10분)
 */
const NAVIGATION_SESSION_TTL = 600;

/**
 * 완전 재검색 서비스
 * - 현재 위치부터 목적지까지 완전히 새로운 경로 생성
 * - 프론트엔드가 "남은 경유지"를 계산하여 전달
 * - circular 경로는 return-to-route 방식만 사용 (재검색 불가)
 */
@Injectable()
export class NavigationRerouteService {
  private readonly redis: Redis;
  private readonly logger = new Logger(NavigationRerouteService.name);

  constructor(
    redisService: RedisService,
    @Inject(forwardRef(() => RoutesService))
    private readonly routesService: RoutesService,
    private readonly helperService: NavigationHelperService,
  ) {
    this.redis = redisService.getOrThrow();
  }

  /**
   * 완전 재검색 (Full Reroute)
   * - 현재 위치에서 새로운 경로를 검색합니다.
   * - 목적지는 Redis에 저장된 원래 경로에서 참조합니다.
   * - 프론트엔드가 계산한 남은 경유지를 사용합니다.
   *
   * @param sessionId 네비게이션 세션 ID
   * @param currentLocation 현재 위치
   * @param remainingWaypoints 남은 경유지 배열 (프론트엔드에서 계산)
   * @returns 재검색된 경로 (geometry 포함)
   */
  async fullReroute(
    sessionId: string,
    currentLocation: CoordinateDto,
    remainingWaypoints?: CoordinateDto[],
  ): Promise<FullRerouteResponseDto> {
    // 1. 원래 경로 조회
    const sessionKey = `navigation:${sessionId}`;
    const sessionJson = await this.redis.get(sessionKey);
    if (!sessionJson) {
      throw new Error('세션을 찾을 수 없습니다.');
    }

    const sessionData = JSON.parse(sessionJson) as {
      routeId: string;
      route: NavigationRouteRedis;
    };
    const originalRoute = sessionData.route;

    // 2. circular 경로는 재검색 불가 (return-to-route만 사용)
    if (originalRoute.routeType === 'circular') {
      throw new Error(
        '원형 경로는 완전 재검색을 지원하지 않습니다. 기존 경로로 복귀(return) 기능을 사용해주세요.',
      );
    }

    // 3. Redis에서 목적지 참조
    const destination = originalRoute.destination;

    this.logger.log(
      `완전 재검색 시작: sessionId=${sessionId}, routeType=${originalRoute.routeType}, ` +
        `currentLocation=(${currentLocation.lat}, ${currentLocation.lng}), ` +
        `destination=(${destination.lat}, ${destination.lng}) [Redis에서 참조], ` +
        `remainingWaypoints=${remainingWaypoints?.length || 0}개`,
    );

    // 4. 경로 재검색 (단일 함수로 통합)
    const newRoutes = await this.searchRoute(
      currentLocation,
      destination,
      remainingWaypoints,
    );

    if (newRoutes.length === 0) {
      throw new Error('재검색된 경로가 없습니다. 경로를 찾을 수 없습니다.');
    }

    // 5. 최적 경로 선택 (원래 카테고리 우선, 없으면 최단 시간)
    const selectedRoute = this.selectBestRoute(newRoutes, originalRoute);

    this.logger.debug(
      `선택된 경로: category=${selectedRoute.routeCategory}, ` +
        `segments=${selectedRoute.segments.length}개`,
    );

    // 5. Instructions 추출
    const allInstructions: InstructionDto[] = selectedRoute.segments
      .filter((segment) => segment && segment.instructions)
      .flatMap((segment) => segment.instructions!);

    if (allInstructions.length === 0) {
      throw new Error(
        '재검색된 경로에 네비게이션 정보가 없습니다. 다시 시도해주세요.',
      );
    }

    this.logger.debug(`통합된 instructions: ${allInstructions.length}개`);

    // 6. Segments 추출 (geometry 포함 - 프론트엔드 응답용)
    const allSegments: RouteSegmentDto[] = selectedRoute.segments.filter(
      (segment) => segment && segment.geometry,
    );

    if (allSegments.length === 0) {
      throw new Error(
        '재검색된 경로에 geometry 정보가 없습니다. 다시 시도해주세요.',
      );
    }

    this.logger.debug(
      `Segments: ${allSegments.length}개, ` +
        `총 geometry points: ${allSegments.reduce((sum, seg) => sum + seg.geometry.points.length, 0)}개`,
    );

    // 7. Redis 저장용 경로 생성 (기존 routeId 유지)
    // - 기존 routeId를 그대로 사용하여 경로만 덮어쓰기
    const routeId = sessionData.routeId;

    const updatedRouteForRedis: NavigationRouteRedis = {
      routeId: routeId, // 기존 routeId 유지
      routeCategory: selectedRoute.routeCategory,
      summary: selectedRoute.summary,
      bbox: selectedRoute.bbox,
      segments: allSegments, // geometry 포함 (Return 시 필요)
      routeType: originalRoute.routeType,
      origin: originalRoute.origin,
      destination: originalRoute.destination,
      waypoints: remainingWaypoints, // 프론트엔드가 계산한 남은 경유지
      targetDistance: originalRoute.targetDistance,
    };

    // 8. Redis 경로 데이터만 업데이트 (세션 데이터는 그대로 유지)
    // - route:abc123 키에 새 경로 덮어쓰기
    // - navigation:sessionId는 이미 routeId를 가지고 있으므로 업데이트 불필요
    await this.redis.setex(
      `route:${routeId}`,
      NAVIGATION_SESSION_TTL,
      JSON.stringify(updatedRouteForRedis),
    );

    this.logger.log(
      `완전 재검색 완료: sessionId=${sessionId}, ` +
        `routeId=${routeId} (경로 데이터 덮어쓰기), ` +
        `segments=${allSegments.length}개, instructions=${allInstructions.length}개, ` +
        `ttl=${NAVIGATION_SESSION_TTL}초`,
    );

    // 9. 프론트엔드 응답 (geometry 포함된 전체 segments)
    return {
      sessionId,
      segments: allSegments,
      instructions: allInstructions,
    };
  }

  // ============================================================================
  // Private Methods - 경로 재검색 및 선택
  // ============================================================================

  /**
   * 경로 재검색 (모든 경로 타입 통합)
   * - 경유지 0개: A → B (direct)
   * - 경유지 1개 이상: A → W1 → W2 → B (multi-leg)
   * - 왕복: A → W1 → W2 → A (roundtrip, destination === origin)
   */
  private async searchRoute(
    start: CoordinateDto,
    end: CoordinateDto,
    waypoints?: CoordinateDto[],
  ): Promise<RouteDto[]> {
    try {
      this.logger.debug(
        `경로 재검색: start=(${start.lat}, ${start.lng}), ` +
          `end=(${end.lat}, ${end.lng}), ` +
          `waypoints=${waypoints?.length || 0}개`,
      );

      return await this.routesService.findFullJourney({
        start,
        end,
        waypoints: waypoints || [],
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '알 수 없는 오류';

      this.logger.error(`경로 재검색 실패: error=${errorMessage}`);

      throw new Error(`경로 재검색 중 문제가 발생했습니다: ${errorMessage}`);
    }
  }

  /**
   * 여러 경로 중 최적 경로 선택
   * 1순위: 원래 카테고리와 동일한 경로
   * 2순위: 최단 시간 경로
   */
  private selectBestRoute(
    routes: RouteDto[],
    originalRoute: NavigationRouteRedis,
  ): RouteDto {
    // 1. 원래 카테고리와 동일한 경로 찾기
    const sameCategory = routes.find(
      (r) => r.routeCategory === originalRoute.routeCategory,
    );

    if (sameCategory) {
      this.logger.debug(
        `원래 카테고리(${originalRoute.routeCategory})와 동일한 경로 선택`,
      );
      return sameCategory;
    }

    // 2. 최단 시간 경로 선택
    const fastestRoute = routes.reduce((fastest, current) => {
      const fastestTime = fastest.segments.reduce(
        (sum, seg) => sum + seg.summary.time,
        0,
      );
      const currentTime = current.segments.reduce(
        (sum, seg) => sum + seg.summary.time,
        0,
      );

      return currentTime < fastestTime ? current : fastest;
    });

    this.logger.debug(
      `원래 카테고리(${originalRoute.routeCategory})를 찾을 수 없어 ` +
        `최단 시간 경로 선택: ${fastestRoute.routeCategory}`,
    );

    return fastestRoute;
  }
}
