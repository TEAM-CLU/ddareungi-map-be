import { ConfigService } from '@nestjs/config';
import { BenchmarkMetricsService } from '../common/benchmark/benchmark-metrics.service';
import { TtsCacheService } from './services/tts-cache.service';
import { TtsStorageService } from './services/tts-storage.service';
import { TtsSynthesisService } from './services/tts-synthesis.service';
import { TtsTextChunkService } from './services/tts-text-chunk.service';
import { TtsService } from './tts.service';

describe('TtsService', () => {
  const getRecordMock = jest.fn();
  const setRecordMock = jest.fn();
  const expireMock = jest.fn();
  const temporaryStorageKeyMock = jest.fn();
  const permanentStorageKeyMock = jest.fn();
  const mergedStorageKeyMock = jest.fn();
  const storageExistsMock = jest.fn();
  const storagePublicUrlMock = jest.fn();
  const normalizeTemporaryTextMock = jest.fn();
  const synthesizeSingleToStorageMock = jest.fn();
  const synthesizeMergedMock = jest.fn();
  const incrementMock = jest.fn();

  const ttsCacheService = {
    getRecord: getRecordMock,
    setRecord: setRecordMock,
    expire: expireMock,
  } as unknown as TtsCacheService;

  const ttsStorageService = {
    temporaryStorageKey: temporaryStorageKeyMock,
    permanentStorageKey: permanentStorageKeyMock,
    mergedStorageKey: mergedStorageKeyMock,
    storageExists: storageExistsMock,
    storagePublicUrl: storagePublicUrlMock,
  } as unknown as TtsStorageService;

  const ttsTextChunkService = {
    normalizeTemporaryText: normalizeTemporaryTextMock,
  } as unknown as TtsTextChunkService;

  const ttsSynthesisService = {
    synthesizeSingleToStorage: synthesizeSingleToStorageMock,
    synthesizeMerged: synthesizeMergedMock,
  } as unknown as TtsSynthesisService;

  const benchmarkMetricsService = {
    increment: incrementMock,
  } as unknown as BenchmarkMetricsService;

  beforeEach(() => {
    jest.clearAllMocks();
    temporaryStorageKeyMock.mockReturnValue('temporary/ko-KR/hash.mp3');
    permanentStorageKeyMock.mockReturnValue('permanent/ko-KR/hash.mp3');
    mergedStorageKeyMock.mockReturnValue('merged/ko-KR/hash.mp3');
    normalizeTemporaryTextMock.mockImplementation((text: string) => text);
  });

  it('should synthesize fulltext audio to Supabase storage', async () => {
    const configService = {
      get: jest.fn((key: string) =>
        key === 'TTS_SYNTHESIS_MODE' ? 'fulltext' : undefined,
      ),
    } as unknown as ConfigService;

    getRecordMock.mockResolvedValue(null);
    storageExistsMock.mockResolvedValue(false);
    synthesizeSingleToStorageMock.mockResolvedValue(
      'https://storage/fulltext.mp3',
    );

    const service = new TtsService(
      configService,
      ttsStorageService,
      ttsTextChunkService,
      ttsSynthesisService,
      ttsCacheService,
      benchmarkMetricsService,
    );

    const result = await service.synthesizeAndCache('우회전입니다');

    expect(synthesizeSingleToStorageMock).toHaveBeenCalledTimes(1);
    expect(synthesizeMergedMock).not.toHaveBeenCalled();
    expect(result.status).toBe('ready');
    expect(result.url).toBe('https://storage/fulltext.mp3');
    expect(incrementMock).toHaveBeenCalledWith('tts_cache_miss_total');
    expect(incrementMock).toHaveBeenCalledWith(
      'tts_fulltext_synthesized_total',
    );
  });

  it('should synthesize chunked audio when chunked mode is enabled', async () => {
    const configService = {
      get: jest.fn((key: string) =>
        key === 'TTS_SYNTHESIS_MODE' ? 'chunked' : undefined,
      ),
    } as unknown as ConfigService;

    getRecordMock.mockResolvedValue(null);
    synthesizeMergedMock.mockResolvedValue({
      mergedHash: 'hash',
      mergedKey: 'merged/ko-KR/hash.mp3',
      mergedUrl: 'https://storage/merged.mp3',
      chunks: [{ text: '우측으로', cacheType: 'permanent' }],
    });

    const service = new TtsService(
      configService,
      ttsStorageService,
      ttsTextChunkService,
      ttsSynthesisService,
      ttsCacheService,
      benchmarkMetricsService,
    );

    const result = await service.synthesizeAndCache(
      '우측으로 공릉로51길로 우회전입니다',
    );

    expect(synthesizeMergedMock).toHaveBeenCalledTimes(1);
    expect(synthesizeSingleToStorageMock).not.toHaveBeenCalled();
    expect(result.status).toBe('ready');
    expect(result.url).toBe('https://storage/merged.mp3');
    expect(incrementMock).toHaveBeenCalledWith('tts_cache_miss_total');
  });
});
