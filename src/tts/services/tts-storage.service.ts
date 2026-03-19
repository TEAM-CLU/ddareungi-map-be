import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  STORAGE_BUCKET,
  STORAGE_PATH_CHUNK_TEMPORARY,
  STORAGE_PATH_MERGED,
  STORAGE_PATH_PERMANENT,
  STORAGE_PATH_TEMP,
} from '../tts.constants';
import { SUPABASE_CLIENT } from '../../common/supabase/supabase.module';

export type StorageFileEntry = {
  path: string;
  createdAt?: string;
  updatedAt?: string;
};

type StorageListItem = {
  name?: string | null;
  id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

@Injectable()
export class TtsStorageService {
  private readonly logger = new Logger(TtsStorageService.name);

  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: SupabaseClient,
  ) {}

  makeStorageKey(scope: string, lang: string, hash: string): string {
    return `${scope}/${lang}/${hash}.mp3`;
  }

  mergedStorageKey(lang: string, hash: string): string {
    return this.makeStorageKey(STORAGE_PATH_MERGED, lang, hash);
  }

  permanentStorageKey(lang: string, hash: string): string {
    return this.makeStorageKey(STORAGE_PATH_PERMANENT, lang, hash);
  }

  temporaryChunkStorageKey(lang: string, hash: string): string {
    return this.makeStorageKey(STORAGE_PATH_CHUNK_TEMPORARY, lang, hash);
  }

  temporaryStorageKey(lang: string, hash: string): string {
    return this.makeStorageKey(STORAGE_PATH_TEMP, lang, hash);
  }

  storagePublicUrl(path: string): string {
    return this.supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data
      .publicUrl;
  }

  async storageExists(path: string): Promise<boolean> {
    const { data, error } = await this.supabase.storage
      .from(STORAGE_BUCKET)
      .download(path);

    return !error && Boolean(data);
  }

  async uploadToStorage(path: string, audioBuffer: Buffer): Promise<string> {
    const { error } = await this.supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (error) {
      this.logger.error(`Supabase upload failed: ${error.message}`);
      throw new InternalServerErrorException(
        'TTS 오디오 업로드에 실패했습니다.',
      );
    }

    return this.storagePublicUrl(path);
  }

  async downloadFromStorage(path: string): Promise<Buffer> {
    const { data, error } = await this.supabase.storage
      .from(STORAGE_BUCKET)
      .download(path);

    if (error || !data) {
      this.logger.error(
        `Supabase download failed: ${error?.message ?? 'empty data'}`,
      );
      throw new InternalServerErrorException(
        'TTS 오디오 다운로드에 실패했습니다.',
      );
    }

    return Buffer.from(await data.arrayBuffer());
  }

  async listStorageFiles(prefix: string): Promise<StorageFileEntry[]> {
    const files: StorageFileEntry[] = [];
    const queue = [prefix];

    while (queue.length > 0) {
      const currentPrefix = queue.shift();
      if (!currentPrefix) {
        continue;
      }

      let offset = 0;
      const limit = 100;

      while (true) {
        const { data, error } = await this.supabase.storage
          .from(STORAGE_BUCKET)
          .list(currentPrefix, {
            limit,
            offset,
            sortBy: { column: 'name', order: 'asc' },
          });

        if (error) {
          this.logger.warn(
            `Supabase storage list failed: prefix=${currentPrefix}, message=${error.message}`,
          );
          break;
        }

        const items = (data ?? []) as StorageListItem[];
        for (const item of items) {
          const name = item.name?.trim();
          if (!name) {
            continue;
          }

          const path = `${currentPrefix}/${name}`;
          const isFile = Boolean(item.id) || name.endsWith('.mp3');
          if (isFile) {
            files.push({
              path,
              createdAt:
                typeof item.created_at === 'string'
                  ? item.created_at
                  : undefined,
              updatedAt:
                typeof item.updated_at === 'string'
                  ? item.updated_at
                  : undefined,
            });
          } else {
            queue.push(path);
          }
        }

        if (items.length < limit) {
          break;
        }

        offset += limit;
      }
    }

    return files;
  }

  async removeStorageFiles(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    const { error } = await this.supabase.storage
      .from(STORAGE_BUCKET)
      .remove(paths);

    if (error) {
      this.logger.warn(`Supabase storage remove failed: ${error.message}`);
      throw new InternalServerErrorException('TTS 오디오 정리에 실패했습니다.');
    }
  }
}
