import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import * as fs from 'fs';
import { BenchmarkMetricsService } from '../common/benchmark/benchmark-metrics.service';

export interface TtsProvider {
  synthesize(text: string, lang?: string, voice?: string): Promise<Buffer>;
}

@Injectable()
export class GoogleTtsProvider implements TtsProvider, OnModuleInit {
  private readonly logger = new Logger(GoogleTtsProvider.name);
  private client!: TextToSpeechClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly benchmarkMetricsService: BenchmarkMetricsService,
  ) {}

  onModuleInit(): void {
    this.initializeClient();
  }

  private initializeClient(): void {
    // 모든 환경(로컬/프로덕션): 서비스 계정 키 파일(GOOGLE_APPLICATION_CREDENTIALS) 사용
    const keyFilename = this.configService.get<string>(
      'GOOGLE_APPLICATION_CREDENTIALS',
    );

    if (!keyFilename) {
      throw new InternalServerErrorException(
        'Google TTS 인증 정보가 설정되지 않았습니다.',
      );
    }

    if (!fs.existsSync(keyFilename)) {
      throw new InternalServerErrorException(
        'Google TTS 인증 파일을 찾을 수 없습니다.',
      );
    }

    this.client = new TextToSpeechClient({ keyFilename });
    this.logger.log(`Google TTS initialized with key file: ${keyFilename}`);
  }

  async synthesize(
    text: string,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<Buffer> {
    try {
      const voiceName = voice || this.getDefaultVoice(lang);
      this.benchmarkMetricsService.increment('google_tts_synthesize_total');
      this.benchmarkMetricsService.increment(
        'google_tts_synthesize_chars_total',
        text.length,
      );

      const [response] = await this.client.synthesizeSpeech({
        input: { text },
        voice: {
          languageCode: lang,
          name: voiceName,
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1.0,
          pitch: 0,
        },
      });

      if (!response.audioContent) {
        throw new InternalServerErrorException(
          'Google TTS 오디오 응답이 비어 있습니다.',
        );
      }

      this.logger.debug(
        `Synthesized audio for text length=${text.length}, lang=${lang}`,
      );

      return Buffer.from(response.audioContent as Uint8Array);
    } catch (error) {
      this.logger.error(
        `Failed to synthesize speech: ${(error as Error).message}`,
        (error as Error).stack,
      );
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException('Google TTS 합성에 실패했습니다.');
    }
  }

  private getDefaultVoice(lang: string): string {
    const voiceMap: Record<string, string> = {
      'ko-KR': 'ko-KR-Wavenet-A',
      'en-US': 'en-US-Standard-C',
      'ja-JP': 'ja-JP-Standard-A',
      'zh-CN': 'cmn-CN-Standard-A',
    };
    return voiceMap[lang] || 'ko-KR-Standard-A';
  }
}
