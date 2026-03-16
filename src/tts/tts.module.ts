import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TtsService } from './tts.service';
import { TtsController } from './tts.controller';
import { GoogleTtsProvider } from './tts.provider';
import { TranslationService } from './translation.service';
import { TtsStorageService } from './services/tts-storage.service';
import { TtsTextChunkService } from './services/tts-text-chunk.service';
import { TtsSynthesisService } from './services/tts-synthesis.service';
import { TtsCacheService } from './services/tts-cache.service';

@Module({
  imports: [ConfigModule],
  controllers: [TtsController],
  providers: [
    TtsService,
    GoogleTtsProvider,
    TranslationService,
    TtsStorageService,
    TtsTextChunkService,
    TtsSynthesisService,
    TtsCacheService,
  ],
  exports: [TtsService, TranslationService],
})
export class TtsModule {}
