import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { TtsRecord, TtsResponseDto } from './dto/tts.dto';
import {
  REDIS_TTL,
  REDIS_TTL_PERMANENT,
  STORAGE_PATH_MERGED,
  STORAGE_PATH_PERMANENT,
  STORAGE_PATH_TEMP,
} from './tts.constants';
import { BenchmarkMetricsService } from '../common/benchmark/benchmark-metrics.service';
import { normalizeText } from './utils/normalize-text';
import { TtsCacheService } from './services/tts-cache.service';
import { TtsStorageService } from './services/tts-storage.service';
import { TtsSynthesisService } from './services/tts-synthesis.service';
import { TtsTextChunkService } from './services/tts-text-chunk.service';

type TtsSynthesisMode = 'fulltext' | 'chunked';
type ListCacheType = 'temporary' | 'permanent';

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly synthesisMode: TtsSynthesisMode;

  constructor(
    private readonly configService: ConfigService,
    private readonly ttsStorageService: TtsStorageService,
    private readonly ttsTextChunkService: TtsTextChunkService,
    private readonly ttsSynthesisService: TtsSynthesisService,
    private readonly ttsCacheService: TtsCacheService,
    private readonly benchmarkMetricsService: BenchmarkMetricsService,
  ) {
    this.synthesisMode =
      this.configService.get<string>('TTS_SYNTHESIS_MODE') === 'chunked'
        ? 'chunked'
        : 'fulltext';
  }

  private hashText(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  private toReadyResponse(record: TtsRecord, hash: string): TtsResponseDto {
    return {
      status: 'ready',
      url: record.ttsUrl ?? record.s3Url,
      textKo: record.textKo,
      hash,
      cached: true,
    };
  }

  private createRecord(params: {
    text: string;
    textKo: string;
    lang: string;
    voice?: string;
    hash: string;
    storageKey: string;
    ttsUrl: string;
  }): TtsRecord {
    return {
      text: params.text,
      textKo: params.textKo,
      lang: params.lang,
      voice: params.voice,
      status: 'ready',
      storageKey: params.storageKey,
      ttsUrl: params.ttsUrl,
      hash: params.hash,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private resolveTemporaryLookupTarget(
    textKo: string,
    lang: string,
    voice?: string,
  ): { hash: string; storageKey: string } {
    if (this.synthesisMode === 'chunked') {
      const hash = this.hashText(`merged:${lang}:${voice || ''}:${textKo}`);
      return {
        hash,
        storageKey: this.ttsStorageService.mergedStorageKey(lang, hash),
      };
    }

    const hash = this.hashText(`${lang}:${voice || ''}:${textKo}`);
    return {
      hash,
      storageKey: this.ttsStorageService.temporaryStorageKey(lang, hash),
    };
  }

  private incrementTemporaryCacheHit(): void {
    this.benchmarkMetricsService.increment('tts_cache_hit_total');
  }

  private incrementTemporaryCacheMiss(): void {
    this.benchmarkMetricsService.increment('tts_cache_miss_total');
  }

  private async synthesizeTemporaryFulltext(
    text: string,
    lang: string,
    voice?: string,
  ): Promise<TtsResponseDto> {
    const normalized = normalizeText(text);
    const textKo = this.ttsTextChunkService.normalizeTemporaryText(normalized);
    const hash = this.hashText(`${lang}:${voice || ''}:${textKo}`);
    const storageKey = this.ttsStorageService.temporaryStorageKey(lang, hash);

    const cachedRecord = await this.ttsCacheService.getRecord(hash);
    if (
      cachedRecord?.status === 'ready' &&
      (cachedRecord.ttsUrl || cachedRecord.s3Url)
    ) {
      this.incrementTemporaryCacheHit();
      await this.ttsCacheService.expire(hash, REDIS_TTL);
      return this.toReadyResponse(cachedRecord, hash);
    }

    this.incrementTemporaryCacheMiss();
    let ttsUrl: string;
    let cached = false;

    if (await this.ttsStorageService.storageExists(storageKey)) {
      ttsUrl = this.ttsStorageService.storagePublicUrl(storageKey);
      cached = true;
    } else {
      this.benchmarkMetricsService.increment('tts_fulltext_synthesized_total');
      this.benchmarkMetricsService.increment(
        'tts_fulltext_synthesized_chars_total',
        textKo.length,
      );
      ttsUrl = await this.ttsSynthesisService.synthesizeSingleToStorage(
        textKo,
        lang,
        storageKey,
        voice,
      );
    }

    const record = this.createRecord({
      text: normalized,
      textKo,
      lang,
      voice,
      hash,
      storageKey,
      ttsUrl,
    });
    await this.ttsCacheService.setRecord(hash, record, REDIS_TTL);

    return {
      status: 'ready',
      url: ttsUrl,
      textKo,
      hash,
      cached,
    };
  }

  private async synthesizeTemporaryChunked(
    text: string,
    lang: string,
    voice?: string,
  ): Promise<TtsResponseDto> {
    const normalized = normalizeText(text);
    const textKo = this.ttsTextChunkService.normalizeTemporaryText(normalized);
    const phraseHash = this.hashText(`${lang}:${voice || ''}:${textKo}`);
    const cachedRecord = await this.ttsCacheService.getRecord(phraseHash);

    if (
      cachedRecord?.status === 'ready' &&
      (cachedRecord.ttsUrl || cachedRecord.s3Url)
    ) {
      this.incrementTemporaryCacheHit();
      await this.ttsCacheService.expire(phraseHash, REDIS_TTL);
      return this.toReadyResponse(cachedRecord, phraseHash);
    }

    this.incrementTemporaryCacheMiss();
    const merged = await this.ttsSynthesisService.synthesizeMerged(
      textKo,
      lang,
      voice,
    );

    const record = this.createRecord({
      text: normalized,
      textKo,
      lang,
      voice,
      hash: phraseHash,
      storageKey: merged.mergedKey,
      ttsUrl: merged.mergedUrl,
    });
    await this.ttsCacheService.setRecord(phraseHash, record, REDIS_TTL);

    return {
      status: 'ready',
      url: merged.mergedUrl,
      textKo,
      hash: phraseHash,
      cached: false,
    };
  }

  async synthesizeAndCache(
    text: string,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<TtsResponseDto> {
    try {
      return this.synthesisMode === 'chunked'
        ? await this.synthesizeTemporaryChunked(text, lang, voice)
        : await this.synthesizeTemporaryFulltext(text, lang, voice);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`TTS synthesis failed: ${message}`, stack);
      return {
        status: 'error',
        hash: this.hashText(text),
        error: message,
        cached: false,
      };
    }
  }

  async batchSynthesize(
    instructions: Array<{ text: string }>,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<Map<string, TtsResponseDto>> {
    const results = new Map<string, TtsResponseDto>();
    const uniqueTexts = Array.from(
      new Set(instructions.map((item) => item.text)),
    ).filter((text) => text && text.trim());

    if (uniqueTexts.length === 0) {
      return results;
    }

    const synthesisResults = await Promise.all(
      uniqueTexts.map(async (sourceText) => ({
        sourceText,
        result: await this.synthesizeAndCache(sourceText, lang, voice),
      })),
    );

    for (const { sourceText, result } of synthesisResults) {
      results.set(sourceText, result);
    }

    return results;
  }

  async batchSynthesizeForNavigation(
    instructions: Array<{ text: string }>,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<Map<string, TtsResponseDto>> {
    return this.batchSynthesize(instructions, lang, voice);
  }

  async synthesizePermanent(
    text: string,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<TtsResponseDto> {
    try {
      const normalized = normalizeText(text);
      const hash = this.hashText(`${lang}:${voice || ''}:${normalized}`);
      const storageKey = this.ttsStorageService.permanentStorageKey(lang, hash);

      const cachedRecord = await this.ttsCacheService.getRecord(hash);
      if (
        cachedRecord?.status === 'ready' &&
        (cachedRecord.ttsUrl || cachedRecord.s3Url)
      ) {
        await this.ttsCacheService.expire(hash, REDIS_TTL_PERMANENT);
        return this.toReadyResponse(cachedRecord, hash);
      }

      let ttsUrl: string;
      let cached = false;

      if (await this.ttsStorageService.storageExists(storageKey)) {
        ttsUrl = this.ttsStorageService.storagePublicUrl(storageKey);
        cached = true;
      } else {
        ttsUrl = await this.ttsSynthesisService.synthesizeSingleToStorage(
          normalized,
          lang,
          storageKey,
          voice,
        );
      }

      const record = this.createRecord({
        text: normalized,
        textKo: normalized,
        lang,
        voice,
        hash,
        storageKey,
        ttsUrl,
      });
      await this.ttsCacheService.setRecord(hash, record, REDIS_TTL_PERMANENT);

      return {
        status: 'ready',
        url: ttsUrl,
        textKo: normalized,
        hash,
        cached,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Permanent TTS synthesis failed: ${message}`, stack);
      return {
        status: 'error',
        hash: this.hashText(text),
        error: message,
        cached: false,
      };
    }
  }

  async lookup(
    text: string,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<TtsResponseDto | null> {
    const normalized = normalizeText(text);
    const textKo = this.ttsTextChunkService.normalizeTemporaryText(normalized);
    const phraseHash = this.hashText(`${lang}:${voice || ''}:${textKo}`);
    const record = await this.ttsCacheService.getRecord(phraseHash);

    if (record?.status === 'ready' && (record.ttsUrl || record.s3Url)) {
      return this.toReadyResponse(record, phraseHash);
    }

    if (record) {
      return {
        status: record.status,
        hash: phraseHash,
        error: record.error,
      };
    }

    const { storageKey } = this.resolveTemporaryLookupTarget(
      textKo,
      lang,
      voice,
    );
    if (!(await this.ttsStorageService.storageExists(storageKey))) {
      return null;
    }

    const ttsUrl = this.ttsStorageService.storagePublicUrl(storageKey);
    const restoredRecord = this.createRecord({
      text: normalized,
      textKo,
      lang,
      voice,
      hash: phraseHash,
      storageKey,
      ttsUrl,
    });
    await this.ttsCacheService.setRecord(phraseHash, restoredRecord, REDIS_TTL);

    return {
      status: 'ready',
      url: ttsUrl,
      textKo,
      hash: phraseHash,
    };
  }

  async lookupPermanent(
    text: string,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<TtsResponseDto | null> {
    const normalized = normalizeText(text);
    const hash = this.hashText(`${lang}:${voice || ''}:${normalized}`);
    const record = await this.ttsCacheService.getRecord(hash);

    if (record?.status === 'ready' && (record.ttsUrl || record.s3Url)) {
      return this.toReadyResponse(record, hash);
    }

    if (record) {
      return {
        status: record.status,
        hash,
        error: record.error,
      };
    }

    const storageKey = this.ttsStorageService.permanentStorageKey(lang, hash);
    if (!(await this.ttsStorageService.storageExists(storageKey))) {
      return null;
    }

    const ttsUrl = this.ttsStorageService.storagePublicUrl(storageKey);
    const restoredRecord = this.createRecord({
      text: normalized,
      textKo: normalized,
      lang,
      voice,
      hash,
      storageKey,
      ttsUrl,
    });
    await this.ttsCacheService.setRecord(
      hash,
      restoredRecord,
      REDIS_TTL_PERMANENT,
    );

    return {
      status: 'ready',
      url: ttsUrl,
      textKo: normalized,
      hash,
    };
  }

  async lookupS3(
    text: string,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<{
    redisCached: boolean;
    s3Exists: boolean;
    s3Key: string;
    url?: string;
  }> {
    const normalized = normalizeText(text);
    const textKo = this.ttsTextChunkService.normalizeTemporaryText(normalized);
    const phraseHash = this.hashText(`${lang}:${voice || ''}:${textKo}`);
    const record = await this.ttsCacheService.getRecord(phraseHash);
    const { storageKey } = this.resolveTemporaryLookupTarget(
      textKo,
      lang,
      voice,
    );
    const exists = await this.ttsStorageService.storageExists(storageKey);

    return {
      redisCached: Boolean(
        record?.status === 'ready' && (record.ttsUrl || record.s3Url),
      ),
      s3Exists: exists,
      s3Key: storageKey,
      url: exists
        ? this.ttsStorageService.storagePublicUrl(storageKey)
        : undefined,
    };
  }

  async lookupS3Permanent(
    text: string,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<{
    redisCached: boolean;
    s3Exists: boolean;
    s3Key: string;
    url?: string;
  }> {
    const normalized = normalizeText(text);
    const hash = this.hashText(`${lang}:${voice || ''}:${normalized}`);
    const record = await this.ttsCacheService.getRecord(hash);
    const storageKey = this.ttsStorageService.permanentStorageKey(lang, hash);
    const exists = await this.ttsStorageService.storageExists(storageKey);

    return {
      redisCached: Boolean(
        record?.status === 'ready' && (record.ttsUrl || record.s3Url),
      ),
      s3Exists: exists,
      s3Key: storageKey,
      url: exists
        ? this.ttsStorageService.storagePublicUrl(storageKey)
        : undefined,
    };
  }

  async listCached(
    type: ListCacheType,
    cursor = '0',
    limit = 200,
  ): Promise<{ items: TtsRecord[]; nextCursor: string }> {
    const count = Math.min(Math.max(limit, 1), 1000);
    const [nextCursor, keys] = await this.ttsCacheService.scanRedisKeys(
      cursor,
      count,
    );

    if (keys.length === 0) {
      return { items: [], nextCursor };
    }

    const items = (await this.ttsCacheService.getPipelineRecords(keys)).filter(
      (record): record is TtsRecord => Boolean(record),
    );

    const expectedPrefix = this.expectedStoragePrefix(type);
    const filtered = items
      .filter((record) => {
        const storageKey = record.storageKey ?? record.s3Key;
        return (
          typeof storageKey === 'string' &&
          storageKey.startsWith(expectedPrefix)
        );
      })
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    return {
      items: filtered,
      nextCursor,
    };
  }

  private expectedStoragePrefix(type: ListCacheType): string {
    if (type === 'permanent') {
      return `${STORAGE_PATH_PERMANENT}/`;
    }

    return this.synthesisMode === 'chunked'
      ? `${STORAGE_PATH_MERGED}/`
      : `${STORAGE_PATH_TEMP}/`;
  }
}
