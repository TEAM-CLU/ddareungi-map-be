import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';

export const TTS_METRIC_COUNTERS = [
  'tts_chunk_synthesized_total',
  'tts_merged_created_total',
  'tts_merged_cache_hit_total',
  'tts_merged_request_total',
  'tts_merged_repeat_request_total',
] as const;

export type TtsMetricCounterName = (typeof TTS_METRIC_COUNTERS)[number];

export type TtsMetricsSnapshot = {
  counters: Record<TtsMetricCounterName, number>;
  ratios: {
    tts_merged_repeat_request_ratio: number;
  };
};

const TTS_METRICS_COUNTERS_KEY = 'tts:metrics:counters';
const TTS_METRICS_SEEN_HASHES_KEY = 'tts:metrics:seen_merged_hashes';

@Injectable()
export class TtsMetricsService {
  private readonly logger = new Logger(TtsMetricsService.name);
  private readonly redis: ReturnType<RedisService['getOrThrow']>;

  constructor(private readonly redisService: RedisService) {
    this.redis = this.redisService.getOrThrow();
  }

  async incrementChunkSynthesized(): Promise<void> {
    await this.increment('tts_chunk_synthesized_total');
  }

  async incrementMergedCreated(): Promise<void> {
    await this.increment('tts_merged_created_total');
  }

  async incrementMergedCacheHit(): Promise<void> {
    await this.increment('tts_merged_cache_hit_total');
  }

  async recordMergedRequest(hash: string): Promise<void> {
    try {
      const added = await this.redis.sadd(TTS_METRICS_SEEN_HASHES_KEY, hash);
      const transaction = this.redis.multi();
      transaction.hincrby(
        TTS_METRICS_COUNTERS_KEY,
        'tts_merged_request_total',
        1,
      );

      if (added === 0) {
        transaction.hincrby(
          TTS_METRICS_COUNTERS_KEY,
          'tts_merged_repeat_request_total',
          1,
        );
      }

      await transaction.exec();
    } catch (error) {
      this.logWriteFailure('merged request metric', error);
    }
  }

  async snapshot(): Promise<TtsMetricsSnapshot> {
    try {
      const values = await this.redis.hmget(
        TTS_METRICS_COUNTERS_KEY,
        ...TTS_METRIC_COUNTERS,
      );
      const counters = Object.fromEntries(
        TTS_METRIC_COUNTERS.map((counter, index) => [
          counter,
          this.parseCounter(values[index]),
        ]),
      ) as Record<TtsMetricCounterName, number>;
      const totalRequests = counters.tts_merged_request_total;
      const repeatRequests = counters.tts_merged_repeat_request_total;

      return {
        counters,
        ratios: {
          tts_merged_repeat_request_ratio:
            totalRequests > 0 ? repeatRequests / totalRequests : 0,
        },
      };
    } catch (error) {
      this.logger.warn(
        `TTS metrics snapshot read failed: ${this.toErrorMessage(error)}`,
      );
      return this.emptySnapshot();
    }
  }

  private async increment(
    name: TtsMetricCounterName,
    value = 1,
  ): Promise<void> {
    try {
      await this.redis.hincrby(TTS_METRICS_COUNTERS_KEY, name, value);
    } catch (error) {
      this.logWriteFailure(`${name} counter`, error);
    }
  }

  private parseCounter(value: string | null | undefined): number {
    if (!value) {
      return 0;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private emptySnapshot(): TtsMetricsSnapshot {
    const counters = Object.fromEntries(
      TTS_METRIC_COUNTERS.map((counter) => [counter, 0]),
    ) as Record<TtsMetricCounterName, number>;

    return {
      counters,
      ratios: {
        tts_merged_repeat_request_ratio: 0,
      },
    };
  }

  private logWriteFailure(operation: string, error: unknown): void {
    this.logger.warn(
      `TTS metrics write failed (${operation}): ${this.toErrorMessage(error)}`,
    );
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'unknown error';
  }
}
