import { BenchmarkMetricsService } from '../../common/benchmark/benchmark-metrics.service';
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
    makeStorageKey: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
    (ttsStorageService.mergedStorageKey as jest.Mock).mockReturnValue(
      'merged/ko-KR/merged-hash.mp3',
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
});
