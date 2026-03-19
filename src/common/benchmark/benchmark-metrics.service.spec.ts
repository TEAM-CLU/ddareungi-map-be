import { ConfigService } from '@nestjs/config';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { BenchmarkMetricsService } from './benchmark-metrics.service';

describe('BenchmarkMetricsService', () => {
  it('clears chunk-temporary storage files during storage cache reset', async () => {
    const listMock = jest.fn(async (prefix: string) => {
      if (prefix === 'chunk-temporary') {
        return {
          data: [
            {
              name: 'old.mp3',
              id: 'file-id',
            },
          ],
          error: null,
        };
      }

      return { data: [], error: null };
    });
    const removeMock = jest.fn().mockResolvedValue({ error: null });
    const fromMock = jest.fn().mockReturnValue({
      list: listMock,
      remove: removeMock,
    });
    const supabase = {
      storage: {
        from: fromMock,
      },
    };
    const redis = {
      scan: jest.fn(),
      del: jest.fn(),
    };
    const redisService = {
      getOrThrow: jest.fn().mockReturnValue(redis),
    } as unknown as RedisService;
    const configService = {
      get: jest.fn((key: string) =>
        key === 'ENABLE_BENCHMARK_METRICS' ? 'true' : undefined,
      ),
    } as unknown as ConfigService;

    const service = new BenchmarkMetricsService(
      configService,
      redisService,
      supabase as never,
    );

    await service.reset({ clearStorageCaches: true });

    expect(removeMock).toHaveBeenCalledWith(['chunk-temporary/old.mp3']);
  });
});
