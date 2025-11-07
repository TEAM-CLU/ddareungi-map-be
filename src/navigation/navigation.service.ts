import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import {
  NavigationSessionDto,
  SegmentInstructionsDto,
} from './dto/navigation.dto';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';
import { randomUUID } from 'crypto';
import { RoutesService } from '../routes/routes.service';
import { InstructionDto } from '../routes/dto/route.dto';
import {
  NAVIGATION_SESSION_TTL,
  REDIS_KEY_PREFIX,
  NavigationHelperService,
} from './services/navigation-helper.service';

@Injectable()
export class NavigationService {
  private readonly redis: Redis;
  private readonly logger = new Logger(NavigationService.name);

  constructor(
    redisService: RedisService,
    @Inject(forwardRef(() => RoutesService))
    private readonly routesService: RoutesService,
    private readonly helperService: NavigationHelperService,
  ) {
    this.redis = redisService.getOrThrow();
  }

  /**
   * 네비게이션 세션 시작
   * - Redis에서 routeId로 RouteDto 조회
   * - 각 segment의 instructions를 추출하여 반환
   * @param routeId 경로 ID
   * @returns NavigationSessionDto (sessionId + 세그먼트별 instructions)
   */
  async startNavigationSession(routeId: string): Promise<NavigationSessionDto> {
    const route = await this.helperService.getRouteData(routeId);

    // segments 필드 확인
    if (!route.segments || !Array.isArray(route.segments)) {
      this.logger.error(
        `segments 필드 누락: routeId=${routeId}, hasSegments=${!!route.segments}`,
      );
      throw new Error(
        '경로 데이터에 segments 정보가 없습니다. 경로를 다시 검색해주세요.',
      );
    }

    // 각 segment의 instructions 추출 및 통합
    const allInstructions: InstructionDto[] = [];

    for (const segment of route.segments) {
      if (segment && segment.instructions && segment.instructions.length > 0) {
        allInstructions.push(...segment.instructions);
      }
    }

    if (allInstructions.length === 0) {
      this.logger.warn(
        `instructions가 있는 segment가 없습니다: ${routeId}, total segments: ${route.segments.length}`,
      );
      throw new Error(
        '경로에 네비게이션 정보가 포함되어 있지 않습니다. 경로를 다시 검색해주세요.',
      );
    }

    // 세션 ID 생성 및 Redis에 저장 (TTL 10분)
    const sessionId = randomUUID();

    // 세그먼트 정보는 내부적으로 저장 (Redis에만)
    const segments: SegmentInstructionsDto[] = route.segments
      .filter((segment) => segment && segment.instructions)
      .map((segment) => ({
        type: segment.type,
        instructions: segment.instructions!,
      }));

    await this.redis.setex(
      `${REDIS_KEY_PREFIX.SESSION}${sessionId}`,
      NAVIGATION_SESSION_TTL,
      JSON.stringify({ routeId, route, segments }),
    );

    this.logger.log(
      `네비게이션 세션 생성: sessionId=${sessionId}, routeId=${routeId}, ` +
        `instructions=${allInstructions.length}개, ttl=${NAVIGATION_SESSION_TTL}초`,
    );

    return { sessionId, instructions: allInstructions };
  }

  /**
   * 네비게이션 세션 heartbeat (TTL 갱신)
   * - 세션과 해당 경로의 TTL을 모두 10분으로 재설정
   * @param sessionId 세션 ID
   * @throws 세션이 존재하지 않는 경우 에러 발생
   */
  async refreshSessionTTL(sessionId: string): Promise<void> {
    const sessionData = await this.helperService.getSessionData(sessionId);
    await this.helperService.refreshSessionTTL(sessionId, sessionData.routeId);

    this.logger.debug(
      `네비게이션 세션 및 경로 TTL 갱신: sessionId=${sessionId}, routeId=${sessionData.routeId}, ttl=${NAVIGATION_SESSION_TTL}초`,
    );
  }
}
