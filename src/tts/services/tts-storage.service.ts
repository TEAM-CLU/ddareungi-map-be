import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  STORAGE_BUCKET,
  STORAGE_PATH_MERGED,
  STORAGE_PATH_PERMANENT,
  STORAGE_PATH_TEMP,
} from '../tts.constants';
import { SUPABASE_CLIENT } from '../../common/supabase/supabase.module';

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
}
