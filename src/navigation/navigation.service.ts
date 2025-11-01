import { Injectable, Logger } from '@nestjs/common';
import {
  NavigationSessionDto,
  SegmentInstructionsDto,
} from './dto/navigation.dto';
import { NavigationRouteRedis } from './dto/navigation-route-redis.interface';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';
import { randomUUID } from 'crypto';

@Injectable()
export class NavigationService {
  private readonly redis: Redis;
  private readonly logger = new Logger(NavigationService.name);

  constructor(redisService: RedisService) {
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
    const routeKey = `route:${routeId}`;
    const routeJson = await this.redis.get(routeKey);

    if (!routeJson) {
      this.logger.error(`경로 데이터를 찾을 수 없습니다: ${routeId}`);
      throw new Error('해당 routeId의 경로 데이터가 존재하지 않습니다.');
    }

    const route = JSON.parse(routeJson) as NavigationRouteRedis;

    // Redis 데이터 구조 검증
    if (!route || typeof route !== 'object') {
      this.logger.error(
        `잘못된 경로 데이터 형식: ${routeId}, data: ${JSON.stringify(route)}`,
      );
      throw new Error('경로 데이터 형식이 올바르지 않습니다.');
    }

    // segments 필드 확인
    if (!route.segments || !Array.isArray(route.segments)) {
      this.logger.error(
        `segments 필드가 없거나 배열이 아닙니다: ${routeId}, segments: ${JSON.stringify(route.segments)}`,
      );
      throw new Error(
        '경로 데이터에 segments 정보가 없습니다. 경로를 다시 검색해주세요.',
      );
    }

    // 각 segment의 instructions 추출 (Redis에는 instructions가 포함되어 있음)
    const segments: SegmentInstructionsDto[] = route.segments
      .filter((segment) => segment && segment.instructions) // instructions가 있는 segment만 필터링
      .map((segment) => ({
        type: segment.type,
        instructions: segment.instructions!,
      }));

    if (segments.length === 0) {
      this.logger.warn(
        `instructions가 있는 segment가 없습니다: ${routeId}, total segments: ${route.segments.length}`,
      );
      throw new Error(
        '경로에 네비게이션 정보가 포함되어 있지 않습니다. 경로를 다시 검색해주세요.',
      );
    }

    // 세션 ID 생성 및 Redis에 저장
    const sessionId = randomUUID();
    await this.redis.setex(
      `navigation:session:${sessionId}`,
      1800, // 30분
      JSON.stringify({ routeId, route, segments }),
    );

    this.logger.log(
      `네비게이션 세션 생성: sessionId=${sessionId}, routeId=${routeId}, segments=${segments.length}개`,
    );

    return { sessionId, segments };
  }
}
