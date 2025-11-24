import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { normalizeText } from './utils/normalize-text';
import { TtsRecord, TtsResponseDto } from './dto/tts.dto';
import { GoogleTtsProvider } from './tts.provider';
import { TranslationService } from './translation.service';
import { S3 } from 'aws-sdk';

/**
 * 상수 정의
 */
const REDIS_PREFIX = 'tts:phrase:';
const REDIS_TTL = 86400 * 30; // 30일 (일반 TTS)
const REDIS_TTL_PERMANENT = 86400 * 365 * 10; // 10년 (고정 메시지용, 사실상 영구)

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private redis: ReturnType<RedisService['getOrThrow']>;
  private s3: S3;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly ttsProvider: GoogleTtsProvider,
    private readonly translationService: TranslationService,
  ) {
    this.redis = this.redisService.getOrThrow();

    // AWS S3 클라이언트 초기화 (NODE_ENV에 따라 분기)
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const awsRegion =
      this.configService.get<string>('AWS_REGION') || 'ap-northeast-2';

    if (nodeEnv === 'local') {
      // 로컬 환경: 환경 변수에서 자격 증명만 사용
      const awsAccessKeyId =
        this.configService.get<string>('AWS_ACCESS_KEY_ID');
      const awsSecretAccessKey = this.configService.get<string>(
        'AWS_SECRET_ACCESS_KEY',
      );
      if (awsAccessKeyId && awsSecretAccessKey) {
        this.s3 = new S3({
          region: awsRegion,
          credentials: {
            accessKeyId: awsAccessKeyId,
            secretAccessKey: awsSecretAccessKey,
          },
        });
        this.logger.log(
          'AWS S3 initialized with credentials from environment variables (Local)',
        );
      } else {
        throw new Error(
          '로컬 환경에서는 AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY가 반드시 필요합니다. .env.local을 확인하세요.',
        );
      }
    } else {
      // 운영/배포 환경: IAM Role만 사용 (환경 변수 무시)
      this.s3 = new S3({ region: awsRegion });
      this.logger.log('AWS S3 initialized with EC2 IAM Role (Production)');
    }
  }

  private hashText(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  private redisKey(hash: string): string {
    return `${REDIS_PREFIX}${hash}`;
  }

  /**
   * 텍스트를 한글로 번역하고 TTS 합성 후 S3에 업로드
   */
  async synthesizeAndCache(
    text: string,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<TtsResponseDto> {
    try {
      // 1. 텍스트 정규화
      const normalized = normalizeText(text);

      // 2. 한글로 번역
      const textKo = this.translationService.translateToKorean(normalized);

      // 3. 해시 생성 (한글 텍스트 기준)
      const hash = this.hashText(`${lang}:${voice || ''}:${textKo}`);
      const key = this.redisKey(hash);

      // 4. Redis 캐시 확인
      const existing = await this.redis.get(key);
      if (existing) {
        try {
          const record = JSON.parse(existing) as TtsRecord;
          if (record.status === 'ready' && record.s3Url) {
            this.logger.debug(`Cache hit for hash=${hash}`);
            return { status: 'ready', url: record.s3Url, hash };
          }
        } catch {
          this.logger.warn(`Failed to parse cached record for hash=${hash}`);
        }
      }

      // 5. TTS 합성
      this.logger.debug(`Synthesizing TTS for text: ${textKo}`);
      const audioBuffer = await this.ttsProvider.synthesize(
        textKo,
        lang,
        voice,
      );

      // 6. S3 업로드
      const bucket = this.configService.get<string>('TTS_S3_BUCKET');
      if (!bucket) {
        throw new Error('TTS_S3_BUCKET not configured');
      }

      const s3Key = `tts/${lang}/${hash}.mp3`;
      await this.s3
        .putObject({
          Bucket: bucket,
          Key: s3Key,
          Body: audioBuffer,
          ContentType: 'audio/mpeg',
          // ACL 제거: 버킷 정책으로 공개 액세스 설정
        })
        .promise();

      const s3Url = `https://${bucket}.s3.amazonaws.com/${s3Key}`;

      // 7. Redis에 저장
      const record: TtsRecord = {
        text: normalized,
        textKo,
        lang,
        voice,
        status: 'ready',
        s3Key,
        s3Url,
        hash,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await this.redis.set(key, JSON.stringify(record), 'EX', REDIS_TTL);

      this.logger.log(`TTS cached successfully: ${hash} -> ${s3Url}`);

      return { status: 'ready', url: s3Url, textKo, hash };
    } catch (error) {
      this.logger.error(
        `TTS synthesis failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return {
        status: 'error',
        hash: this.hashText(text),
        error: (error as Error).message,
      };
    }
  }

  /**
   * 인스트럭션 배열을 일괄 처리 (최적화 버전)
   * - 중복 제거: 동일한 텍스트는 한 번만 처리
   * - 병렬 처리: 독립적인 인스트럭션들을 동시에 처리
   */
  async batchSynthesize(
    instructions: Array<{ text: string }>,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<Map<string, TtsResponseDto>> {
    const results = new Map<string, TtsResponseDto>();

    // 1. 중복 제거: 고유한 텍스트만 추출
    const uniqueTexts = Array.from(
      new Set(instructions.map((i) => i.text)),
    ).filter((text) => text && text.trim());

    if (uniqueTexts.length === 0) {
      return results;
    }

    this.logger.log(
      `Batch synthesis: ${instructions.length} instructions, ${uniqueTexts.length} unique`,
    );

    // 2. 병렬 처리: 모든 고유 텍스트 동시 처리
    const synthesisPromises = uniqueTexts.map((text) =>
      this.synthesizeAndCache(text, lang, voice).then((result) => ({
        text,
        result,
      })),
    );

    const synthesisResults = await Promise.all(synthesisPromises);

    // 3. 결과 매핑
    for (const { text, result } of synthesisResults) {
      results.set(text, result);
    }

    const successCount = synthesisResults.filter(
      (r) => r.result.status === 'ready',
    ).length;
    this.logger.log(
      `Batch synthesis complete: ${successCount}/${uniqueTexts.length} succeeded`,
    );

    return results;
  }

  /**
   * 고정 메시지용 TTS 생성 (만료되지 않음)
   * - 사용 예: "음성 안내를 시작합니다", "음성 안내를 종료합니다"
   * - Redis TTL: 10년 (사실상 영구)
   */
  async synthesizePermanent(
    text: string,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<TtsResponseDto> {
    try {
      // 1. 텍스트 정규화 (번역 없이 그대로 사용)
      const normalized = normalizeText(text);

      // 2. 해시 생성
      const hash = this.hashText(`${lang}:${voice || ''}:${normalized}`);
      const key = this.redisKey(hash);

      // 3. Redis 캐시 확인
      const existing = await this.redis.get(key);
      if (existing) {
        try {
          const record = JSON.parse(existing) as TtsRecord;
          if (record.status === 'ready' && record.s3Url) {
            this.logger.debug(`Cache hit for permanent message: ${text}`);
            return { status: 'ready', url: record.s3Url, textKo: text, hash };
          }
        } catch {
          this.logger.warn(`Failed to parse cached permanent message: ${text}`);
        }
      }

      // 4. TTS 합성
      this.logger.log(`Synthesizing permanent TTS for: ${text}`);
      const audioBuffer = await this.ttsProvider.synthesize(
        normalized,
        lang,
        voice,
      );

      // 5. S3 업로드
      const bucket = this.configService.get<string>('TTS_S3_BUCKET');
      if (!bucket) {
        throw new Error('TTS_S3_BUCKET not configured');
      }

      const s3Key = `tts/${lang}/${hash}.mp3`;
      await this.s3
        .putObject({
          Bucket: bucket,
          Key: s3Key,
          Body: audioBuffer,
          ContentType: 'audio/mpeg',
        })
        .promise();

      const s3Url = `https://${bucket}.s3.amazonaws.com/${s3Key}`;

      // 6. Redis에 영구 저장 (10년 TTL)
      const record: TtsRecord = {
        text: normalized,
        textKo: normalized,
        lang,
        voice,
        status: 'ready',
        s3Key,
        s3Url,
        hash,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await this.redis.set(
        key,
        JSON.stringify(record),
        'EX',
        REDIS_TTL_PERMANENT,
      );

      this.logger.log(`Permanent TTS cached successfully: ${text} -> ${s3Url}`);

      return { status: 'ready', url: s3Url, textKo: normalized, hash };
    } catch (error) {
      this.logger.error(
        `Permanent TTS synthesis failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return {
        status: 'error',
        hash: this.hashText(text),
        error: (error as Error).message,
      };
    }
  }

  /**
   * 캐시된 TTS 조회
   */
  async lookup(
    text: string,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<TtsResponseDto | null> {
    const normalized = normalizeText(text);
    const textKo = this.translationService.translateToKorean(normalized);
    const hash = this.hashText(`${lang}:${voice || ''}:${textKo}`);
    const key = this.redisKey(hash);

    const existing = await this.redis.get(key);
    if (!existing) {
      return null;
    }

    try {
      const record = JSON.parse(existing) as TtsRecord;
      if (record.status === 'ready' && record.s3Url) {
        return { status: 'ready', url: record.s3Url, hash };
      }
      return { status: record.status, hash, error: record.error };
    } catch {
      return null;
    }
  }

  /**
   * 고정 메시지 캐시 조회 (번역 없이)
   */
  async lookupPermanent(
    text: string,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<TtsResponseDto | null> {
    const normalized = normalizeText(text);
    const hash = this.hashText(`${lang}:${voice || ''}:${normalized}`);
    const key = this.redisKey(hash);

    const existing = await this.redis.get(key);
    if (!existing) {
      return null;
    }

    try {
      const record = JSON.parse(existing) as TtsRecord;
      if (record.status === 'ready' && record.s3Url) {
        return { status: 'ready', url: record.s3Url, textKo: text, hash };
      }
      return { status: record.status, hash, error: record.error };
    } catch {
      return null;
    }
  }
}
