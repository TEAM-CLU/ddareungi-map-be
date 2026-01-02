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

    // AWS S3 클라이언트 초기화
    const awsRegion =
      this.configService.get<string>('AWS_REGION') || 'ap-northeast-2';
    const awsAccessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const awsSecretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
    );

    if (awsAccessKeyId && awsSecretAccessKey) {
      // 로컬 개발 환경: 환경 변수에서 자격 증명 사용
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
      // EC2 배포 환경: IAM Role 사용 (자동 인증)
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

      // Redis 저장은 debug 레벨로만 로깅 (개별 저장은 너무 많음)
      this.logger.debug(`TTS cached successfully: ${hash} -> ${s3Url}`);

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
    type SynthesisResult =
      | { text: string; result: TtsResponseDto; success: boolean }
      | {
          text: string;
          result: { status: 'error'; hash: string; error: string };
          success: false;
          error: unknown;
        };

    // 1. 중복 제거: 고유한 텍스트만 추출
    const uniqueTexts = Array.from(
      new Set(instructions.map((i) => i.text)),
    ).filter((text) => text && text.trim());

    if (uniqueTexts.length === 0) {
      return results;
    }

    // 2. 병렬 처리: 모든 고유 텍스트 동시 처리
    const synthesisPromises: Array<Promise<SynthesisResult>> = uniqueTexts.map(
      (text) =>
        this.synthesizeAndCache(text, lang, voice)
          .then((result) => ({
            text,
            result,
            success: result.status === 'ready',
          }))
          .catch((error: unknown) => ({
            text,
            result: {
              status: 'error' as const,
              hash: '',
              error: error instanceof Error ? error.message : String(error),
            },
            success: false,
            error,
          })),
    );

    const synthesisResults = await Promise.all(synthesisPromises);

    // 3. 결과 매핑
    for (const { text, result } of synthesisResults) {
      results.set(text, result);
    }

    // 배치 로깅: 성공/실패 집계
    const successCount = synthesisResults.filter((r) => r.success).length;
    const failureCount = synthesisResults.length - successCount;
    const failures = synthesisResults.filter((r) => !r.success);

    // Redis 저장 결과 집계 (status === 'ready'이고 url이 있으면 Redis 저장 성공으로 간주)
    const redisSaveSuccess = synthesisResults.filter(
      (r) => r.result.status === 'ready' && r.result.url,
    ).length;
    const redisSaveFail = synthesisResults.length - redisSaveSuccess;
    const redisFailures = synthesisResults.filter(
      (r) => r.result.status !== 'ready' || !r.result.url,
    );

    if (failureCount === 0) {
      this.logger.debug(
        `[TTS] 배치 합성 완료: ${successCount}/${uniqueTexts.length}개 성공 (Redis 저장: ${redisSaveSuccess}/${uniqueTexts.length}개 성공)`,
      );
    } else {
      this.logger.error(
        `[TTS] 배치 합성 완료: ${successCount}/${uniqueTexts.length}개 성공, ${failureCount}개 실패 (Redis 저장: ${redisSaveSuccess}/${uniqueTexts.length}개 성공, ${redisSaveFail}개 실패)`,
      );
      // 실패한 항목만 상세 로깅
      for (const failure of failures) {
        const errorInfo: string =
          'error' in failure
            ? failure.error instanceof Error
              ? (failure.error.stack ?? failure.error.message)
              : String(failure.error)
            : failure.result.error || 'Unknown error';
        this.logger.error(`[TTS] 합성 실패 - Text: ${failure.text}`, errorInfo);
      }
      // Redis 저장 실패만 상세 로깅 (합성은 성공했지만 Redis 저장 실패한 경우)
      const redisOnlyFailures = redisFailures.filter(
        (r) => r.success && (r.result.status !== 'ready' || !r.result.url),
      );
      if (redisOnlyFailures.length > 0) {
        for (const redisFailure of redisOnlyFailures) {
          this.logger.error(
            `[TTS] Redis 저장 실패 - Text: ${redisFailure.text}, Hash: ${redisFailure.result.hash || 'N/A'}`,
          );
        }
      }
    }

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
      this.logger.debug(`Synthesizing permanent TTS for: ${text}`);
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

      // Redis 저장은 debug 레벨로만 로깅
      this.logger.debug(
        `Permanent TTS cached successfully: ${text} -> ${s3Url}`,
      );

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
