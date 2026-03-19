import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  STORAGE_PATH_CHUNK_TEMPORARY,
  STORAGE_PATH_MERGED,
  STORAGE_TTL_CHUNK_TEMPORARY_SECONDS,
  STORAGE_TTL_MERGED_SECONDS,
} from '../tts.constants';
import { StorageFileEntry, TtsStorageService } from './tts-storage.service';

@Injectable()
export class TtsStorageCleanupService {
  private readonly logger = new Logger(TtsStorageCleanupService.name);

  constructor(private readonly ttsStorageService: TtsStorageService) {}

  @Cron('0 * * * *')
  async cleanupExpiredFiles(): Promise<void> {
    await this.cleanupPrefix(STORAGE_PATH_MERGED, STORAGE_TTL_MERGED_SECONDS);
    await this.cleanupPrefix(
      STORAGE_PATH_CHUNK_TEMPORARY,
      STORAGE_TTL_CHUNK_TEMPORARY_SECONDS,
    );
  }

  private async cleanupPrefix(
    prefix: string,
    ttlSeconds: number,
  ): Promise<void> {
    const files = await this.ttsStorageService.listStorageFiles(prefix);
    const expiredPaths = files
      .filter((file) => this.isExpired(file, ttlSeconds))
      .map((file) => file.path);

    if (expiredPaths.length === 0) {
      return;
    }

    for (let index = 0; index < expiredPaths.length; index += 100) {
      const batch = expiredPaths.slice(index, index + 100);

      try {
        await this.ttsStorageService.removeStorageFiles(batch);
      } catch (error) {
        this.logger.warn(
          `만료된 TTS 스토리지 정리 실패: prefix=${prefix}, batchSize=${batch.length}, message=${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
  }

  private isExpired(file: StorageFileEntry, ttlSeconds: number): boolean {
    const timestamp = file.updatedAt ?? file.createdAt;
    if (!timestamp) {
      return false;
    }

    const createdAt = Date.parse(timestamp);
    if (Number.isNaN(createdAt)) {
      return false;
    }

    return Date.now() - createdAt > ttlSeconds * 1000;
  }
}
