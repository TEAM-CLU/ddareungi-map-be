import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface TtsProvider {
  synthesize(text: string, lang?: string, voice?: string): Promise<Buffer>;
}

@Injectable()
export class GoogleTtsProvider implements TtsProvider, OnModuleInit {
  private readonly logger = new Logger(GoogleTtsProvider.name);
  private client!: TextToSpeechClient;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.initializeClient();
  }

  private async initializeClient(): Promise<void> {
    const nodeEnv = this.configService.get<string>('NODE_ENV');

    if (nodeEnv === 'local') {
      // 로컬 환경: GOOGLE_APPLICATION_CREDENTIALS만 사용
      const keyFilename = this.configService.get<string>(
        'GOOGLE_APPLICATION_CREDENTIALS',
      );
      if (keyFilename && fs.existsSync(keyFilename)) {
        this.client = new TextToSpeechClient({ keyFilename });
        this.logger.log(`Google TTS initialized with key file: ${keyFilename}`);
        return;
      }
      throw new Error(
        'GOOGLE_APPLICATION_CREDENTIALS 파일이 존재하지 않습니다. .env.local을 확인하세요.',
      );
    } else {
      // 운영/배포 환경: GOOGLE_CREDENTIALS_SECRET_NAME만 사용
      const secretName = this.configService.get<string>(
        'GOOGLE_CREDENTIALS_SECRET_NAME',
      );
      if (secretName) {
        try {
          const credentialsJson =
            await this.getCredentialsFromSecretsManager(secretName);
          const tempKeyPath = this.writeTempKeyFile(credentialsJson);
          this.client = new TextToSpeechClient({ keyFilename: tempKeyPath });
          this.logger.log(
            'Google TTS initialized with credentials from AWS Secrets Manager',
          );
          return;
        } catch (error) {
          this.logger.error(
            `Failed to get credentials from Secrets Manager: ${(error as Error).message}`,
          );
          throw error;
        }
      }
      throw new Error(
        'GOOGLE_CREDENTIALS_SECRET_NAME이 설정되어 있지 않습니다. .env.production을 확인하세요.',
      );
    }
  }

  private async getCredentialsFromSecretsManager(
    secretName: string,
  ): Promise<string> {
    const region =
      this.configService.get<string>('AWS_REGION') || 'ap-northeast-2';

    const client = new SecretsManagerClient({ region });

    try {
      const command = new GetSecretValueCommand({ SecretId: secretName });

      const response = await client.send(command);

      const secretString = response.SecretString;
      if (!secretString) {
        throw new Error('Secret value is empty');
      }

      this.logger.log(
        `Retrieved secret from AWS Secrets Manager: ${secretName}`,
      );
      return secretString;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve secret ${secretName}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  private writeTempKeyFile(credentialsJson: string): string {
    // JSON 파싱 및 private_key 줄바꿈 치환

    // Google 서비스 계정 키 타입 일부만 명시
    type GoogleServiceAccountKey = {
      private_key?: string;
      [key: string]: unknown;
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const parsed: GoogleServiceAccountKey = JSON.parse(credentialsJson);
    if (typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    const fixedJson = JSON.stringify(parsed, null, 2);

    const tempDir = os.tmpdir();
    const keyPath = path.join(tempDir, `google-credentials-${Date.now()}.json`);

    fs.writeFileSync(keyPath, fixedJson, 'utf-8');
    this.logger.debug(`Wrote temporary credentials file to ${keyPath}`);

    return keyPath;
  }

  async synthesize(
    text: string,
    lang = 'ko-KR',
    voice?: string,
  ): Promise<Buffer> {
    try {
      const voiceName = voice || this.getDefaultVoice(lang);

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
        throw new Error('No audio content returned from Google TTS');
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
      throw error;
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
