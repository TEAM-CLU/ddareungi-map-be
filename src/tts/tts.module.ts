import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TtsService } from './tts.service';
import { TtsController } from './tts.controller';
import { InternalTtsController } from './internal-tts.controller';
import { TtsMetricsService } from './tts-metrics.service';
import { GoogleTtsProvider } from './tts.provider';
import { TranslationService } from './translation.service';
import { TtsStorageService } from './services/tts-storage.service';
import { TtsStorageCleanupService } from './services/tts-storage-cleanup.service';
import { TtsTextChunkService } from './services/tts-text-chunk.service';
import { TtsSynthesisService } from './services/tts-synthesis.service';
import { TtsCacheService } from './services/tts-cache.service';

@Module({
  imports: [ConfigModule],
  controllers: [TtsController, InternalTtsController],
  providers: [
    TtsService,
    TtsMetricsService,
    GoogleTtsProvider,
    TranslationService,
    TtsStorageService,
    TtsStorageCleanupService,
    TtsTextChunkService,
    TtsSynthesisService,
    TtsCacheService,
  ],
  exports: [TtsService, TranslationService],
})
export class TtsModule {}
