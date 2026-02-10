import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';
import * as crypto from 'crypto';

type AcquireOneResult =
  | { mode: 'locked'; token: string }
  | { mode: 'skipped' }
  | { mode: 'bypass'; reason: string };

type AcquireManyResult =
  | {
      mode: 'locked';
      tokensByKey: Map<string, string>;
      skippedKeys: string[];
    }
  | { mode: 'bypass'; reason: string };

@Injectable()
export class StationSyncLockService {
  private readonly logger = new Logger(StationSyncLockService.name);
  private readonly redis: Redis;

  constructor(private readonly redisService: RedisService) {
    this.redis = this.redisService.getOrThrow();
  }

  async tryAcquire(key: string, ttlSeconds: number): Promise<AcquireOneResult> {
    try {
      const token = crypto.randomBytes(16).toString('hex');

      // SET key token NX EX ttlSeconds
      const result = await this.redis.set(key, token, 'EX', ttlSeconds, 'NX');
      if (result !== 'OK') {
        this.logger.debug({ message: 'lock skipped', key, ttlSeconds });
        return { mode: 'skipped' };
      }

      this.logger.debug({ message: 'lock acquired', key, ttlSeconds });
      return { mode: 'locked', token };
    } catch (error) {
      // Redis 장애/네트워크 오류 시: 락 기능을 포기하고 중복 호출을 감수
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn({ message: 'lock bypass (redis error)', key, reason });
      return { mode: 'bypass', reason };
    }
  }

  /**
   * 여러 키 락을 한 번에 획득 (pipeline)하여 RTT를 줄입니다.
   * Redis 장애 시에는 락 기능을 포기하고 bypass 모드로 반환합니다.
   */
  async tryAcquireMany(
    keys: string[],
    ttlSeconds: number,
  ): Promise<AcquireManyResult> {
    if (keys.length === 0) {
      return { mode: 'locked', tokensByKey: new Map(), skippedKeys: [] };
    }

    const tokensByKey = new Map<string, string>();
    const tokens: string[] = keys.map(() =>
      crypto.randomBytes(16).toString('hex'),
    );

    try {
      const pipeline = this.redis.pipeline();
      for (let i = 0; i < keys.length; i++) {
        pipeline.set(keys[i], tokens[i], 'EX', ttlSeconds, 'NX');
      }

      const results = await pipeline.exec();
      const skippedKeys: string[] = [];

      for (let i = 0; i < keys.length; i++) {
        const [err, res] = results?.[i] ?? [
          new Error('pipeline result missing'),
          null,
        ];
        if (err) {
          // 파이프라인 중 개별 명령 오류도 Redis 이상으로 간주해 bypass
          const reason = err instanceof Error ? err.message : String(err);
          this.logger.warn({
            message: 'lock bypass (redis pipeline error)',
            reason,
          });
          return { mode: 'bypass', reason };
        }

        if (res === 'OK') {
          tokensByKey.set(keys[i], tokens[i]);
        } else {
          skippedKeys.push(keys[i]);
        }
      }

      this.logger.debug({
        message: 'lock acquire many done',
        ttlSeconds,
        acquired: tokensByKey.size,
        skipped: skippedKeys.length,
      });
      return { mode: 'locked', tokensByKey, skippedKeys };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn({ message: 'lock bypass (redis error)', reason });
      return { mode: 'bypass', reason };
    }
  }

  async release(key: string, token: string): Promise<void> {
    // 토큰이 일치할 때만 삭제 (다른 요청이 획득한 락을 지우지 않도록)
    const lua = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;

    try {
      await this.redis.eval(lua, 1, key, token);
      this.logger.debug({ message: 'lock released', key });
    } catch (error) {
      this.logger.warn({
        message: 'lock release failed',
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
