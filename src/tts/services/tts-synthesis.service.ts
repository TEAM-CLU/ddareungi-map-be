import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BenchmarkMetricsService } from '../../common/benchmark/benchmark-metrics.service';
import { GoogleTtsProvider } from '../tts.provider';
import { STORAGE_PATH_PERMANENT, STORAGE_PATH_TEMP } from '../tts.constants';
import { CacheType, SplitChunk } from '../types/tts-cache.types';
import { TtsStorageService } from './tts-storage.service';
import { TtsTextChunkService } from './tts-text-chunk.service';

@Injectable()
export class TtsSynthesisService {
  private readonly logger = new Logger(TtsSynthesisService.name);

  constructor(
    private readonly ttsProvider: GoogleTtsProvider,
    private readonly ttsStorageService: TtsStorageService,
    private readonly ttsTextChunkService: TtsTextChunkService,
    private readonly benchmarkMetricsService: BenchmarkMetricsService,
  ) {}

  private hashText(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  private async mergeAudioChunks(buffers: Buffer[]): Promise<Buffer> {
    if (buffers.length === 0) {
      throw new InternalServerErrorException('병합할 오디오 청크가 없습니다.');
    }

    if (buffers.length === 1) {
      return buffers[0];
    }

    const workdir = join(tmpdir(), `tts-merge-${randomUUID()}`);
    await fs.mkdir(workdir, { recursive: true });

    try {
      const inputFiles: string[] = [];
      for (let index = 0; index < buffers.length; index++) {
        const file = join(workdir, `chunk-${index}.mp3`);
        await fs.writeFile(file, buffers[index]);
        inputFiles.push(file);
      }

      const listFile = join(workdir, 'inputs.txt');
      const listContent = inputFiles
        .map((file) => `file '${file.replace(/'/g, `'\\''`)}'`)
        .join('\n');
      await fs.writeFile(listFile, listContent, 'utf8');

      const outputFile = join(workdir, 'merged.mp3');
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(listFile)
          .inputOptions(['-f concat', '-safe 0'])
          .outputOptions(['-c copy'])
          .output(outputFile)
          .on('end', () => resolve())
          .on('error', (error) => reject(error))
          .run();
      });

      return fs.readFile(outputFile);
    } catch (error) {
      this.logger.error(
        '오디오 청크 병합 실패',
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException('TTS 오디오 병합에 실패했습니다.');
    } finally {
      await fs.rm(workdir, { recursive: true, force: true });
    }
  }

  private async getChunkBuffer(
    chunk: SplitChunk,
    lang: string,
    voice?: string,
  ): Promise<{
    hash: string;
    key: string;
    url: string;
    cached: boolean;
    buffer: Buffer;
  }> {
    const chunkHash = this.hashText(`${lang}:${voice || ''}:${chunk.text}`);
    const scope =
      chunk.cacheType === 'permanent'
        ? STORAGE_PATH_PERMANENT
        : STORAGE_PATH_TEMP;
    const key = this.ttsStorageService.makeStorageKey(scope, lang, chunkHash);
    const url = this.ttsStorageService.storagePublicUrl(key);

    if (await this.ttsStorageService.storageExists(key)) {
      this.benchmarkMetricsService.increment('tts_chunk_cache_hit_total');
      const buffer = await this.ttsStorageService.downloadFromStorage(key);
      return { hash: chunkHash, key, url, cached: true, buffer };
    }

    this.benchmarkMetricsService.increment('tts_chunk_synthesized_total');
    this.benchmarkMetricsService.increment(
      'tts_chunk_synthesized_chars_total',
      chunk.text.length,
    );
    const audioBuffer = await this.ttsProvider.synthesize(
      chunk.text,
      lang,
      voice,
    );
    const uploadedUrl = await this.ttsStorageService.uploadToStorage(
      key,
      audioBuffer,
    );

    return {
      hash: chunkHash,
      key,
      url: uploadedUrl,
      cached: false,
      buffer: audioBuffer,
    };
  }

  async synthesizeMerged(
    sourceText: string,
    lang: string,
    voice?: string,
  ): Promise<{
    mergedHash: string;
    mergedKey: string;
    mergedUrl: string;
    chunks: Array<{
      text: string;
      cacheType: CacheType;
      hash: string;
      key: string;
      url: string;
      cached: boolean;
    }>;
  }> {
    const mergedHash = this.hashText(
      `merged:${lang}:${voice || ''}:${sourceText}`,
    );
    const mergedKey = this.ttsStorageService.mergedStorageKey(lang, mergedHash);

    if (await this.ttsStorageService.storageExists(mergedKey)) {
      this.benchmarkMetricsService.increment('tts_merged_cache_hit_total');
      return {
        mergedHash,
        mergedKey,
        mergedUrl: this.ttsStorageService.storagePublicUrl(mergedKey),
        chunks: [],
      };
    }

    const chunks = this.ttsTextChunkService.splitNavigationText(sourceText);
    const chunkResults = await Promise.all(
      chunks.map(async (chunk) => {
        const result = await this.getChunkBuffer(chunk, lang, voice);
        return {
          text: chunk.text,
          cacheType: chunk.cacheType,
          hash: result.hash,
          key: result.key,
          url: result.url,
          cached: result.cached,
          buffer: result.buffer,
        };
      }),
    );

    this.benchmarkMetricsService.increment('tts_merged_created_total');
    const mergedBuffer = await this.mergeAudioChunks(
      chunkResults.map((chunk) => chunk.buffer),
    );
    const mergedUrl = await this.ttsStorageService.uploadToStorage(
      mergedKey,
      mergedBuffer,
    );

    return {
      mergedHash,
      mergedKey,
      mergedUrl,
      chunks: chunkResults.map((chunk) => ({
        text: chunk.text,
        cacheType: chunk.cacheType,
        hash: chunk.hash,
        key: chunk.key,
        url: chunk.url,
        cached: chunk.cached,
      })),
    };
  }

  async synthesizeSingleToStorage(
    text: string,
    lang: string,
    storageKey: string,
    voice?: string,
  ): Promise<string> {
    const audioBuffer = await this.ttsProvider.synthesize(text, lang, voice);
    return this.ttsStorageService.uploadToStorage(storageKey, audioBuffer);
  }
}
