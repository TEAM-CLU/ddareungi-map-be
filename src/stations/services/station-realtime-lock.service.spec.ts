import { RedisService } from '@liaoliaots/nestjs-redis';
import { ConfigService } from '@nestjs/config';
import {
  StationRealtimeLockService,
  type StationRealtimeLock,
} from './station-realtime-lock.service';

describe('StationRealtimeLockService', () => {
  const redis = {
    set: jest.fn(),
    eval: jest.fn(),
  };

  const redisService = {
    getOrThrow: jest.fn(() => redis),
  } as unknown as RedisService;
  const configService = {
    get: jest.fn().mockReturnValue('true'),
  } as unknown as ConfigService;
  const benchmarkMetricsService = {
    increment: jest.fn(),
  };

  let service: StationRealtimeLockService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StationRealtimeLockService(
      redisService,
      configService,
      benchmarkMetricsService as never,
    );
  });

  it('should acquire a lock with NX PX options', async () => {
    redis.set.mockResolvedValue('OK');

    const lock = await service.acquire('ST-1001');

    expect(lock).not.toBeNull();
    expect(redis.set).toHaveBeenCalledWith(
      'station:realtime-sync:lock:ST-1001',
      expect.any(String),
      'PX',
      15000,
      'NX',
    );
    expect(benchmarkMetricsService.increment).toHaveBeenCalledWith(
      'station_lock_acquired_total',
    );
  });

  it('should return null when lock is already held', async () => {
    redis.set.mockResolvedValue(null);

    await expect(service.acquire('ST-1001')).resolves.toBeNull();
    expect(benchmarkMetricsService.increment).toHaveBeenCalledWith(
      'station_lock_skipped_total',
    );
  });

  it('should release a lock only when token matches', async () => {
    redis.eval.mockResolvedValue(1);

    const released = await service.release({
      key: 'station:realtime-sync:lock:ST-1001',
      token: 'token-123',
    });

    expect(released).toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("GET", KEYS[1]) == ARGV[1]'),
      1,
      'station:realtime-sync:lock:ST-1001',
      'token-123',
    );
  });

  it('should return false when lock release does not delete the key', async () => {
    redis.eval.mockResolvedValue(0);

    await expect(
      service.release({
        key: 'station:realtime-sync:lock:ST-1001',
        token: 'token-123',
      } as StationRealtimeLock),
    ).resolves.toBe(false);
  });

  it('should bypass redis when lock is disabled', async () => {
    (configService.get as jest.Mock).mockReturnValueOnce('false');
    service = new StationRealtimeLockService(
      redisService,
      configService,
      benchmarkMetricsService as never,
    );

    const lock = await service.acquire('ST-1001');

    expect(lock).not.toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
    await expect(service.release(lock as StationRealtimeLock)).resolves.toBe(
      true,
    );
  });
});
