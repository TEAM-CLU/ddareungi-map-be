import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

export interface TtsProvider {
  synthesize(text: string, lang?: string, voice?: string): Promise<Buffer>;
}

@Injectable()
export class GoogleTtsProvider implements TtsProvider {
  private readonly logger = new Logger(GoogleTtsProvider.name);
  private readonly client: TextToSpeechClient;

  constructor(private readonly configService: ConfigService) {
    const keyFilename = this.configService.get<string>(
      'GOOGLE_APPLICATION_CREDENTIALS',
    );
    this.client = new TextToSpeechClient(
      keyFilename ? { keyFilename } : undefined,
    );
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
