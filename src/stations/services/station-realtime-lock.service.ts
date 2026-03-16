import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { BenchmarkMetricsService } from '../../common/benchmark/benchmark-metrics.service';

const STATION_REALTIME_LOCK_PREFIX = 'station:realtime-sync:lock:';
const STATION_REALTIME_LOCK_TTL_MS = 15000;

export interface StationRealtimeLock {
  key: string;
  token: string;
}

@Injectable()
export class StationRealtimeLockService {
  private readonly logger = new Logger(StationRealtimeLockService.name);
  private readonly redis: ReturnType<RedisService['getOrThrow']>;
  private readonly lockEnabled: boolean;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly benchmarkMetricsService: BenchmarkMetricsService,
  ) {
    this.redis = this.redisService.getOrThrow();
    this.lockEnabled =
      this.configService.get<string>('STATION_REALTIME_LOCK_ENABLED') !==
      'false';
  }

  private lockKey(stationId: string): string {
    return `${STATION_REALTIME_LOCK_PREFIX}${stationId}`;
  }

  async acquire(stationId: string): Promise<StationRealtimeLock | null> {
    if (!this.lockEnabled) {
      return {
        key: `station:realtime-sync:disabled:${stationId}:${randomUUID()}`,
        token: randomUUID(),
      };
    }

    const lock = {
      key: this.lockKey(stationId),
      token: randomUUID(),
    };

    try {
      const result = await this.redis.set(
        lock.key,
        lock.token,
        'PX',
        STATION_REALTIME_LOCK_TTL_MS,
        'NX',
      );

      if (result === 'OK') {
        this.benchmarkMetricsService.increment('station_lock_acquired_total');
        return lock;
      }

      this.benchmarkMetricsService.increment('station_lock_skipped_total');
      return null;
    } catch (error) {
      this.logger.error(
        `대여소 실시간 락 획득 실패: ${stationId}`,
        error instanceof Error ? error.stack : undefined,
      );
      this.benchmarkMetricsService.increment('station_lock_skipped_total');
      return null;
    }
  }

  async release(lock: StationRealtimeLock): Promise<boolean> {
    if (
      !this.lockEnabled ||
      lock.key.startsWith('station:realtime-sync:disabled:')
    ) {
      return true;
    }

    const releaseScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0
    `;

    try {
      const result = await this.redis.eval(
        releaseScript,
        1,
        lock.key,
        lock.token,
      );

      return result === 1;
    } catch (error) {
      this.logger.error(
        `대여소 실시간 락 해제 실패: ${lock.key}`,
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    }
  }
}
