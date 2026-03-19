import { RedisService } from '@liaoliaots/nestjs-redis';
import { TtsMetricsService } from './tts-metrics.service';

describe('TtsMetricsService', () => {
  const execMock = jest.fn();
  const multiMock = jest.fn(() => ({
    hincrby: hincrbyInMultiMock,
    exec: execMock,
  }));
  const hincrbyInMultiMock = jest.fn();
  const saddMock = jest.fn();
  const hincrbyMock = jest.fn();
  const hmgetMock = jest.fn();

  const redis = {
    sadd: saddMock,
    multi: multiMock,
    hincrby: hincrbyMock,
    hmget: hmgetMock,
  };
  const redisService = {
    getOrThrow: jest.fn(() => redis),
  } as unknown as RedisService;

  let service: TtsMetricsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TtsMetricsService(redisService);
  });

  it('increments chunk, merged created, and cache hit counters via redis hash', async () => {
    hincrbyMock.mockResolvedValue(1);

    await service.incrementChunkSynthesized();
    await service.incrementMergedCreated();
    await service.incrementMergedCacheHit();

    expect(hincrbyMock).toHaveBeenNthCalledWith(
      1,
      'tts:metrics:counters',
      'tts_chunk_synthesized_total',
      1,
    );
    expect(hincrbyMock).toHaveBeenNthCalledWith(
      2,
      'tts:metrics:counters',
      'tts_merged_created_total',
      1,
    );
    expect(hincrbyMock).toHaveBeenNthCalledWith(
      3,
      'tts:metrics:counters',
      'tts_merged_cache_hit_total',
      1,
    );
  });

  it('tracks repeat merged hash requests using redis set membership', async () => {
    saddMock.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    execMock.mockResolvedValue([['ok'], ['ok']]);

    await service.recordMergedRequest('hash-a');
    await service.recordMergedRequest('hash-a');

    expect(saddMock).toHaveBeenNthCalledWith(
      1,
      'tts:metrics:seen_merged_hashes',
      'hash-a',
    );
    expect(saddMock).toHaveBeenNthCalledWith(
      2,
      'tts:metrics:seen_merged_hashes',
      'hash-a',
    );
    expect(hincrbyInMultiMock).toHaveBeenNthCalledWith(
      1,
      'tts:metrics:counters',
      'tts_merged_request_total',
      1,
    );
    expect(hincrbyInMultiMock).toHaveBeenNthCalledWith(
      2,
      'tts:metrics:counters',
      'tts_merged_request_total',
      1,
    );
    expect(hincrbyInMultiMock).toHaveBeenNthCalledWith(
      3,
      'tts:metrics:counters',
      'tts_merged_repeat_request_total',
      1,
    );
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it('builds snapshot and repeat ratio from redis counters', async () => {
    hmgetMock.mockResolvedValue(['1', '2', '3', '4', '1']);

    const snapshot = await service.snapshot();

    expect(hmgetMock).toHaveBeenCalledWith(
      'tts:metrics:counters',
      'tts_chunk_synthesized_total',
      'tts_merged_created_total',
      'tts_merged_cache_hit_total',
      'tts_merged_request_total',
      'tts_merged_repeat_request_total',
    );
    expect(snapshot.counters.tts_merged_request_total).toBe(4);
    expect(snapshot.counters.tts_merged_repeat_request_total).toBe(1);
    expect(snapshot.ratios.tts_merged_repeat_request_ratio).toBeCloseTo(0.25);
  });

  it('returns zero snapshot when redis has no stored values', async () => {
    hmgetMock.mockResolvedValue([null, null, null, null, null]);

    const snapshot = await service.snapshot();

    expect(snapshot.counters.tts_chunk_synthesized_total).toBe(0);
    expect(snapshot.counters.tts_merged_created_total).toBe(0);
    expect(snapshot.counters.tts_merged_cache_hit_total).toBe(0);
    expect(snapshot.counters.tts_merged_request_total).toBe(0);
    expect(snapshot.counters.tts_merged_repeat_request_total).toBe(0);
    expect(snapshot.ratios.tts_merged_repeat_request_ratio).toBe(0);
  });
});
