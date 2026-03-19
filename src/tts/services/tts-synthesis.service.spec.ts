import { BenchmarkMetricsService } from '../../common/benchmark/benchmark-metrics.service';
import { TtsMetricsService } from '../tts-metrics.service';
import { GoogleTtsProvider } from '../tts.provider';
import { TtsStorageService } from './tts-storage.service';
import { TtsSynthesisService } from './tts-synthesis.service';
import { TtsTextChunkService } from './tts-text-chunk.service';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('TtsSynthesisService', () => {
  const synthesizeMock = jest.fn();
  const storageExistsMock = jest.fn();
  const storagePublicUrlMock = jest.fn();
  const uploadToStorageMock = jest.fn();
  const splitNavigationTextMock = jest.fn();
  const incrementMock = jest.fn();

  const ttsProvider = {
    synthesize: synthesizeMock,
  } as unknown as GoogleTtsProvider;

  const ttsStorageService = {
    mergedStorageKey: jest.fn(),
    permanentStorageKey: jest.fn(),
    temporaryChunkStorageKey: jest.fn(),
    storageExists: storageExistsMock,
    storagePublicUrl: storagePublicUrlMock,
    uploadToStorage: uploadToStorageMock,
    downloadFromStorage: jest.fn(),
  } as unknown as TtsStorageService;

  const ttsTextChunkService = {
    splitNavigationText: splitNavigationTextMock,
  } as unknown as TtsTextChunkService;

  const benchmarkMetricsService = {
    increment: incrementMock,
  } as unknown as BenchmarkMetricsService;

  const ttsMetricsService = {
    incrementChunkSynthesized: jest.fn().mockResolvedValue(undefined),
    incrementMergedCreated: jest.fn().mockResolvedValue(undefined),
    incrementMergedCacheHit: jest.fn().mockResolvedValue(undefined),
  } as unknown as TtsMetricsService;

  beforeEach(() => {
    jest.clearAllMocks();
    (ttsStorageService.mergedStorageKey as jest.Mock).mockReturnValue(
      'merged/ko-KR/merged-hash.mp3',
    );
    (ttsStorageService.permanentStorageKey as jest.Mock).mockImplementation(
      (_lang: string, hash: string) => `permanent/ko-KR/${hash}.mp3`,
    );
    (
      ttsStorageService.temporaryChunkStorageKey as jest.Mock
    ).mockImplementation(
      (_lang: string, hash: string) => `chunk-temporary/ko-KR/${hash}.mp3`,
    );
    storagePublicUrlMock.mockReturnValue(
      'https://storage.example.com/merged/ko-KR/merged-hash.mp3',
    );
    uploadToStorageMock.mockResolvedValue(
      'https://storage.example.com/merged/ko-KR/merged-hash.mp3',
    );
  });

  it('returns merged audio immediately when merged cache already exists', async () => {
    storageExistsMock.mockResolvedValue(true);

    const service = new TtsSynthesisService(
      ttsProvider,
      ttsStorageService,
      ttsTextChunkService,
      benchmarkMetricsService,
      ttsMetricsService,
    );

    const result = await service.synthesizeMerged('우회전입니다', 'ko-KR');

    expect(splitNavigationTextMock).not.toHaveBeenCalled();
    expect(uploadToStorageMock).not.toHaveBeenCalled();
    expect(result.chunks).toEqual([]);
    expect(result.mergedKey).toBe('merged/ko-KR/merged-hash.mp3');
    expect(result.mergedUrl).toBe(
      'https://storage.example.com/merged/ko-KR/merged-hash.mp3',
    );
    expect(incrementMock).toHaveBeenCalledWith('tts_merged_cache_hit_total');
    expect(
      ttsMetricsService.incrementMergedCacheHit as jest.Mock,
    ).toHaveBeenCalledTimes(1);
  });

  it('starts all chunk work before merge and preserves chunk order', async () => {
    storageExistsMock.mockResolvedValue(false);
    splitNavigationTextMock.mockReturnValue([
      { text: '좌회전', cacheType: 'permanent' },
      { text: '공릉로', cacheType: 'temporary' },
    ]);

    const service = new TtsSynthesisService(
      ttsProvider,
      ttsStorageService,
      ttsTextChunkService,
      benchmarkMetricsService,
      ttsMetricsService,
    );

    const first = createDeferred<{
      hash: string;
      key: string;
      url: string;
      cached: boolean;
      buffer: Buffer;
    }>();
    const second = createDeferred<{
      hash: string;
      key: string;
      url: string;
      cached: boolean;
      buffer: Buffer;
    }>();

    const getChunkBufferSpy = jest
      .spyOn(service as never, 'getChunkBuffer' as never)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const mergeAudioChunksSpy = jest
      .spyOn(service as never, 'mergeAudioChunks' as never)
      .mockResolvedValue(Buffer.from('merged-audio'));

    const promise = service.synthesizeMerged('좌회전 공릉로', 'ko-KR');

    await Promise.resolve();
    expect(getChunkBufferSpy).toHaveBeenCalledTimes(2);
    expect(mergeAudioChunksSpy).not.toHaveBeenCalled();

    first.resolve({
      hash: 'chunk-1',
      key: 'temporary/ko-KR/chunk-1.mp3',
      url: 'https://storage/chunk-1.mp3',
      cached: false,
      buffer: Buffer.from('first'),
    });

    await Promise.resolve();
    expect(mergeAudioChunksSpy).not.toHaveBeenCalled();

    second.resolve({
      hash: 'chunk-2',
      key: 'temporary/ko-KR/chunk-2.mp3',
      url: 'https://storage/chunk-2.mp3',
      cached: true,
      buffer: Buffer.from('second'),
    });

    const result = await promise;

    expect(mergeAudioChunksSpy).toHaveBeenCalledWith([
      Buffer.from('first'),
      Buffer.from('second'),
    ]);
    expect(uploadToStorageMock).toHaveBeenCalledWith(
      'merged/ko-KR/merged-hash.mp3',
      Buffer.from('merged-audio'),
    );
    expect(incrementMock).toHaveBeenCalledWith('tts_merged_created_total');
    expect(
      ttsMetricsService.incrementMergedCreated as jest.Mock,
    ).toHaveBeenCalledTimes(1);
    expect(result.chunks).toEqual([
      {
        text: '좌회전',
        cacheType: 'permanent',
        hash: 'chunk-1',
        key: 'temporary/ko-KR/chunk-1.mp3',
        url: 'https://storage/chunk-1.mp3',
        cached: false,
      },
      {
        text: '공릉로',
        cacheType: 'temporary',
        hash: 'chunk-2',
        key: 'temporary/ko-KR/chunk-2.mp3',
        url: 'https://storage/chunk-2.mp3',
        cached: true,
      },
    ]);
  });

  it('stores temporary chunks under the chunk-temporary prefix', async () => {
    storageExistsMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    splitNavigationTextMock.mockReturnValue([
      { text: '공릉로', cacheType: 'temporary' },
    ]);
    synthesizeMock.mockResolvedValue(Buffer.from('chunk-audio'));

    const service = new TtsSynthesisService(
      ttsProvider,
      ttsStorageService,
      ttsTextChunkService,
      benchmarkMetricsService,
      ttsMetricsService,
    );
    jest
      .spyOn(service as never, 'mergeAudioChunks' as never)
      .mockResolvedValue(Buffer.from('merged-audio'));

    await service.synthesizeMerged('공릉로', 'ko-KR');

    expect(
      ttsStorageService.temporaryChunkStorageKey as jest.Mock,
    ).toHaveBeenCalledTimes(1);
    expect(uploadToStorageMock).toHaveBeenCalledWith(
      expect.stringMatching(/^chunk-temporary\/ko-KR\//),
      Buffer.from('chunk-audio'),
    );
    expect(
      ttsMetricsService.incrementChunkSynthesized as jest.Mock,
    ).toHaveBeenCalledTimes(1);
  });
});
