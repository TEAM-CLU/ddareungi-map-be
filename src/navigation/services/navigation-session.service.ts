import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';
import { randomUUID } from 'crypto';
import { NavigationRouteRedis } from '../dto/navigation-route-redis.interface';

/**
 * Redis 키 프리픽스
 */
export const REDIS_KEY_PREFIX = {
  SESSION: 'navigation:',
  ROUTE: 'route:',
} as const;

/**
 * 네비게이션 세션 TTL (1시간)
 */
export const NAVIGATION_SESSION_TTL = 3600;

/**
 * 세션 데이터 인터페이스
 * - 세션에는 routeId만 저장하고, route는 별도 키로 관리
 */
export interface NavigationSessionData {
  routeId: string;
  createdAt: number;
}

/**
 * 세션과 경로를 함께 반환하는 인터페이스
 */
export interface NavigationSessionWithRoute {
  sessionId: string;
  routeId: string;
  route: NavigationRouteRedis;
  createdAt: number;
}

/**
 * 네비게이션 세션 관리 서비스
 * - Redis를 통한 세션 CRUD 전담
 * - 세션 생성, 조회, 갱신, 삭제
 */
@Injectable()
export class NavigationSessionService {
  private readonly logger = new Logger(NavigationSessionService.name);
  public readonly redis: Redis;

  constructor(private readonly redisService: RedisService) {
    this.redis = this.redisService.getOrThrow();
  }

  /**
   * 새로운 네비게이션 세션 생성
   * - route는 이미 saveRoute()로 저장되어 있어야 함
   * - 세션에는 routeId 참조만 저장
   * @param routeId 경로 ID
   * @returns sessionId
   */
  async createSession(routeId: string): Promise<string> {
    const sessionId = randomUUID();
    const sessionData: NavigationSessionData = {
      routeId,
      createdAt: Date.now(),
    };

    await this.redis.setex(
      `${REDIS_KEY_PREFIX.SESSION}${sessionId}`,
      NAVIGATION_SESSION_TTL,
      JSON.stringify(sessionData),
    );

    this.logger.log(
      `세션 생성: sessionId=${sessionId}, routeId=${routeId}, ttl=${NAVIGATION_SESSION_TTL}초`,
    );

    return sessionId;
  }

  /**
   * 세션 데이터 조회
   * @param sessionId 세션 ID
   * @returns 세션 데이터
   * @throws 세션이 존재하지 않는 경우
   */
  async getSession(sessionId: string): Promise<NavigationSessionData> {
    const key = `${REDIS_KEY_PREFIX.SESSION}${sessionId}`;
    const data = await this.redis.get(key);

    if (!data) {
      this.logger.warn(`세션을 찾을 수 없음: ${sessionId}`);
      throw new Error('세션을 찾을 수 없습니다.');
    }

    return JSON.parse(data) as NavigationSessionData;
  }

  /**
   * 세션 데이터 업데이트
   * @param sessionId 세션 ID
   * @param sessionData 업데이트할 세션 데이터
   */
  async updateSession(
    sessionId: string,
    sessionData: NavigationSessionData,
  ): Promise<void> {
    const key = `${REDIS_KEY_PREFIX.SESSION}${sessionId}`;

    await this.redis.setex(
      key,
      NAVIGATION_SESSION_TTL,
      JSON.stringify(sessionData),
    );

    this.logger.debug(`세션 업데이트: sessionId=${sessionId}`);
  }

  /**
   * 세션 TTL 갱신 (세션 + 경로)
   * - 세션과 경로의 TTL을 함께 갱신
   * @param sessionId 세션 ID
   * @param routeId 경로 ID
   */
  async refreshSessionTTL(sessionId: string, routeId: string): Promise<void> {
    const sessionKey = `${REDIS_KEY_PREFIX.SESSION}${sessionId}`;
    const routeKey = `${REDIS_KEY_PREFIX.ROUTE}${routeId}`;

    // 세션과 경로 TTL 동시 갱신
    await Promise.all([
      this.redis.expire(sessionKey, NAVIGATION_SESSION_TTL),
      this.redis.expire(routeKey, NAVIGATION_SESSION_TTL),
    ]);

    this.logger.debug(
      `세션 및 경로 TTL 갱신: sessionId=${sessionId}, routeId=${routeId}`,
    );
  }

  /**
   * 세션 삭제 (세션 + 경로)
   * @param sessionId 세션 ID
   * @returns 삭제된 경로 ID
   */
  async deleteSession(sessionId: string): Promise<string> {
    const sessionData = await this.getSession(sessionId);
    const routeId = sessionData.routeId;

    const sessionKey = `${REDIS_KEY_PREFIX.SESSION}${sessionId}`;
    const routeKey = `${REDIS_KEY_PREFIX.ROUTE}${routeId}`;

    await this.redis.del(sessionKey, routeKey);

    this.logger.log(`세션 삭제: sessionId=${sessionId}, routeId=${routeId}`);

    return routeId;
  }

  /**
   * 경로 데이터 조회
   * @param routeId 경로 ID
   * @returns 경로 데이터
   * @throws 경로가 존재하지 않는 경우
   */
  async getRoute(routeId: string): Promise<NavigationRouteRedis> {
    const key = `${REDIS_KEY_PREFIX.ROUTE}${routeId}`;
    const data = await this.redis.get(key);

    if (!data) {
      this.logger.warn(`경로를 찾을 수 없음: ${routeId}`);
      throw new Error('경로를 찾을 수 없습니다. 경로를 다시 검색해주세요.');
    }

    return JSON.parse(data) as NavigationRouteRedis;
  }

  /**
   * 경로 데이터 저장/업데이트
   * @param routeId 경로 ID
   * @param route 경로 데이터
   */
  async saveRoute(routeId: string, route: NavigationRouteRedis): Promise<void> {
    const key = `${REDIS_KEY_PREFIX.ROUTE}${routeId}`;

    await this.redis.setex(key, NAVIGATION_SESSION_TTL, JSON.stringify(route));

    this.logger.debug(`경로 저장: routeId=${routeId}`);
  }

  /**
   * 경로 삭제
   * @param routeId 경로 ID
   */
  async deleteRoute(routeId: string): Promise<void> {
    const key = `${REDIS_KEY_PREFIX.ROUTE}${routeId}`;
    await this.redis.del(key);

    this.logger.debug(`경로 삭제: routeId=${routeId}`);
  }

  /**
   * 세션과 경로를 함께 조회
   * - 세션에서 routeId를 얻고, route를 별도로 조회하여 반환
   * @param sessionId 세션 ID
   * @returns 세션 + 경로 데이터
   */
  async getSessionWithRoute(
    sessionId: string,
  ): Promise<NavigationSessionWithRoute> {
    const sessionData = await this.getSession(sessionId);
    const route = await this.getRoute(sessionData.routeId);

    return {
      sessionId,
      routeId: sessionData.routeId,
      route,
      createdAt: sessionData.createdAt,
    };
  }
}
