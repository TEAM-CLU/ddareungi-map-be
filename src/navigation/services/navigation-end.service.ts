import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';

/**
 * 네비게이션 세션 종료 서비스
 */
@Injectable()
export class NavigationEndService {
  private readonly logger = new Logger(NavigationEndService.name);
  private readonly redis: Redis;

  constructor(private readonly redisService: RedisService) {
    this.redis = this.redisService.getOrThrow();
  }

  /**
   * 네비게이션 세션 종료
   * @param sessionId 세션 ID
   * @throws Error 세션을 찾을 수 없거나 삭제에 실패한 경우
   */
  async endNavigationSession(sessionId: string): Promise<void> {
    this.logger.log(`세션 종료 시작: ${sessionId}`);

    const sessionKey = `navigation:${sessionId}`;
    const sessionDataStr = await this.redis.get(sessionKey);

    if (!sessionDataStr) {
      this.logger.warn(`세션을 찾을 수 없음: ${sessionId}`);
      throw new Error('세션을 찾을 수 없습니다.');
    }

    const sessionData = JSON.parse(sessionDataStr) as {
      routeId?: string;
    };
    const routeId = sessionData.routeId ?? '';

    if (!routeId) {
      this.logger.warn(`routeId가 없음: ${sessionId}`);
      throw new Error('세션 데이터가 유효하지 않습니다.');
    }

    const routeKey = `route:${routeId}`;
    await this.redis.del(sessionKey, routeKey);

    this.logger.log(`세션 종료 완료: ${sessionId}, routeId: ${routeId}`);
  }
}
