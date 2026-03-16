import { Injectable } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { TtsRecord } from '../dto/tts.dto';
import { REDIS_PREFIX } from '../tts.constants';

@Injectable()
export class TtsCacheService {
  private readonly redis: ReturnType<RedisService['getOrThrow']>;

  constructor(private readonly redisService: RedisService) {
    this.redis = this.redisService.getOrThrow();
  }

  redisKey(hash: string): string {
    return `${REDIS_PREFIX}${hash}`;
  }

  private parseRecord(raw: string): TtsRecord | null {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      if (
        typeof parsed.status !== 'string' ||
        typeof parsed.hash !== 'string' ||
        typeof parsed.text !== 'string' ||
        typeof parsed.textKo !== 'string' ||
        typeof parsed.lang !== 'string'
      ) {
        return null;
      }

      return {
        text: parsed.text,
        textKo: parsed.textKo,
        lang: parsed.lang,
        voice: typeof parsed.voice === 'string' ? parsed.voice : undefined,
        status: parsed.status as TtsRecord['status'],
        storageKey:
          typeof parsed.storageKey === 'string'
            ? parsed.storageKey
            : typeof parsed.s3Key === 'string'
              ? parsed.s3Key
              : undefined,
        ttsUrl:
          typeof parsed.ttsUrl === 'string'
            ? parsed.ttsUrl
            : typeof parsed.s3Url === 'string'
              ? parsed.s3Url
              : undefined,
        s3Key: typeof parsed.s3Key === 'string' ? parsed.s3Key : undefined,
        s3Url: typeof parsed.s3Url === 'string' ? parsed.s3Url : undefined,
        hash: parsed.hash,
        createdAt:
          typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
        updatedAt:
          typeof parsed.updatedAt === 'number' ? parsed.updatedAt : undefined,
        error: typeof parsed.error === 'string' ? parsed.error : undefined,
      };
    } catch {
      return null;
    }
  }

  async getRecord(hash: string): Promise<TtsRecord | null> {
    const raw = await this.redis.get(this.redisKey(hash));
    if (!raw) {
      return null;
    }

    return this.parseRecord(raw);
  }

  async setRecord(hash: string, record: TtsRecord, ttl: number): Promise<void> {
    await this.redis.set(
      this.redisKey(hash),
      JSON.stringify(record),
      'EX',
      ttl,
    );
  }

  async expire(hash: string, ttl: number): Promise<void> {
    await this.redis.expire(this.redisKey(hash), ttl);
  }

  async scanRedisKeys(
    cursor: string,
    count: number,
  ): Promise<[string, string[]]> {
    return (await this.redis.scan(
      cursor,
      'MATCH',
      `${REDIS_PREFIX}*`,
      'COUNT',
      count,
    )) as [string, string[]];
  }

  async mget(keys: string[]): Promise<Array<string | null>> {
    if (keys.length === 0) {
      return [];
    }

    return this.redis.mget(...keys);
  }

  async getPipelineRecords(keys: string[]): Promise<Array<TtsRecord | null>> {
    if (keys.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();
    for (const key of keys) {
      pipeline.get(key);
      pipeline.ttl(key);
    }

    const results = await pipeline.exec();
    const records: Array<TtsRecord | null> = [];

    for (let i = 0; i < keys.length; i++) {
      const getRes = results?.[i * 2];
      const value = (getRes?.[1] as string | null) ?? null;
      records.push(value ? this.parseRecord(value) : null);
    }

    return records;
  }
}
