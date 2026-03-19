import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';
import {
  STORAGE_PATH_CHUNK_TEMPORARY,
  STORAGE_PATH_MERGED,
  STORAGE_PATH_PERMANENT,
  STORAGE_PATH_TEMP,
} from '../../tts/tts.constants';

const REDIS_CACHE_PATTERNS = [
  'tts:phrase:*',
  'navigation:session:*',
  'route:*',
];
const TTS_STORAGE_BUCKET = 'tts';
const TTS_STORAGE_PREFIXES = [
  STORAGE_PATH_TEMP,
  STORAGE_PATH_CHUNK_TEMPORARY,
  STORAGE_PATH_PERMANENT,
  STORAGE_PATH_MERGED,
];

const DEFAULT_COUNTERS = [
  'station_sync_requested_total',
  'station_lock_acquired_total',
  'station_lock_skipped_total',
  'seoul_realtime_fetch_started_total',
  'seoul_realtime_fetch_completed_total',
  'google_tts_synthesize_total',
  'google_tts_synthesize_chars_total',
  'tts_cache_hit_total',
  'tts_cache_miss_total',
  'tts_fulltext_synthesized_total',
  'tts_fulltext_synthesized_chars_total',
  'tts_chunk_cache_hit_total',
  'tts_chunk_synthesized_total',
  'tts_chunk_synthesized_chars_total',
  'tts_merged_cache_hit_total',
  'tts_merged_created_total',
] as const;

type StorageListItem = {
  name?: string | null;
  id?: string | null;
};

@Injectable()
export class BenchmarkMetricsService {
  private readonly logger = new Logger(BenchmarkMetricsService.name);
  private readonly counters = new Map<string, number>();
  private readonly redis: Redis;
  readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    redisService: RedisService,
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {
    this.redis = redisService.getOrThrow();
    this.enabled =
      this.configService.get<string>('ENABLE_BENCHMARK_METRICS') === 'true';
    this.resetCounters();
  }

  increment(name: string, value = 1): void {
    if (!this.enabled) {
      return;
    }

    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(
      DEFAULT_COUNTERS.map((name) => [name, this.counters.get(name) ?? 0]),
    );
  }

  resetCounters(): Record<string, number> {
    this.counters.clear();
    for (const counter of DEFAULT_COUNTERS) {
      this.counters.set(counter, 0);
    }
    return this.snapshot();
  }

  async reset(options?: {
    clearCaches?: boolean;
    clearRedisCaches?: boolean;
    clearStorageCaches?: boolean;
  }): Promise<{
    enabled: boolean;
    counters: Record<string, number>;
    deletedRedisKeys: number;
    deletedStorageFiles: number;
  }> {
    const counters = this.resetCounters();
    if (!this.enabled) {
      return {
        enabled: false,
        counters,
        deletedRedisKeys: 0,
        deletedStorageFiles: 0,
      };
    }

    const clearRedisCaches =
      options?.clearCaches === true || options?.clearRedisCaches === true;
    const clearStorageCaches =
      options?.clearCaches === true || options?.clearStorageCaches === true;

    const deletedRedisKeys = clearRedisCaches
      ? await this.clearRedisCaches()
      : 0;
    const deletedStorageFiles = clearStorageCaches
      ? await this.clearStorageCaches()
      : 0;

    return {
      enabled: true,
      counters,
      deletedRedisKeys,
      deletedStorageFiles,
    };
  }

  private async clearRedisCaches(): Promise<number> {
    let deleted = 0;

    for (const pattern of REDIS_CACHE_PATTERNS) {
      let cursor = '0';

      do {
        const [nextCursor, keys] = (await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          500,
        )) as [string, string[]];

        if (keys.length > 0) {
          deleted += await this.redis.del(...keys);
        }

        cursor = nextCursor;
      } while (cursor !== '0');
    }

    return deleted;
  }

  private async clearStorageCaches(): Promise<number> {
    let deleted = 0;

    for (const prefix of TTS_STORAGE_PREFIXES) {
      const files = await this.listStorageFiles(prefix);
      if (files.length === 0) {
        continue;
      }

      for (let index = 0; index < files.length; index += 100) {
        const chunk = files.slice(index, index + 100);
        const { error } = await this.supabase.storage
          .from(TTS_STORAGE_BUCKET)
          .remove(chunk);

        if (error) {
          this.logger.warn(
            `벤치마크 스토리지 정리 실패: prefix=${prefix}, message=${error.message}`,
          );
          continue;
        }

        deleted += chunk.length;
      }
    }

    return deleted;
  }

  private async listStorageFiles(prefix: string): Promise<string[]> {
    const files: string[] = [];
    const queue = [prefix];

    while (queue.length > 0) {
      const currentPrefix = queue.shift();
      if (!currentPrefix) {
        continue;
      }

      let offset = 0;
      const limit = 100;

      while (true) {
        const { data, error } = await this.supabase.storage
          .from(TTS_STORAGE_BUCKET)
          .list(currentPrefix, {
            limit,
            offset,
            sortBy: { column: 'name', order: 'asc' },
          });

        if (error) {
          this.logger.warn(
            `벤치마크 스토리지 목록 조회 실패: prefix=${currentPrefix}, message=${error.message}`,
          );
          break;
        }

        const items = (data ?? []) as StorageListItem[];
        for (const item of items) {
          const name = item.name?.trim();
          if (!name) {
            continue;
          }

          const path = `${currentPrefix}/${name}`;
          const isFile = Boolean(item.id) || name.endsWith('.mp3');
          if (isFile) {
            files.push(path);
          } else {
            queue.push(path);
          }
        }

        if (items.length < limit) {
          break;
        }

        offset += limit;
      }
    }

    return files;
  }
}
