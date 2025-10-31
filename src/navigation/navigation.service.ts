import { Injectable } from '@nestjs/common';
import { NavigationSessionDto } from './dto/navigation.dto';
import {
  NavigationRouteRedis,
  NavigationGraphHopperInstruction,
} from './dto/navigation-route-redis.interface';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';
import { randomUUID } from 'crypto';

@Injectable()
export class NavigationService {
  private readonly redis: Redis;

  constructor(redisService: RedisService) {
    this.redis = redisService.getOrThrow();
  }

  async startNavigationSession(routeId: string): Promise<NavigationSessionDto> {
    const routeKey = `route:${routeId}`;
    const routeJson = await this.redis.get(routeKey);
    if (!routeJson) {
      throw new Error('해당 routeId의 경로 데이터가 존재하지 않습니다.');
    }
    const route = JSON.parse(routeJson) as NavigationRouteRedis;

    const instructions: NavigationGraphHopperInstruction[] = Array.isArray(
      route.instructions,
    )
      ? route.instructions
      : [];
    const sessionId = randomUUID();
    await this.redis.setex(
      `navigation:session:${sessionId}`,
      1800,
      JSON.stringify({ routeId, route, instructions }),
    );
    return { sessionId, instructions };
  }
}
