import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TtsService } from './tts.service';
import { TtsController } from './tts.controller';
import { GoogleTtsProvider } from './tts.provider';
import { TranslationService } from './translation.service';

@Module({
  imports: [ConfigModule],
  controllers: [TtsController],
  providers: [TtsService, GoogleTtsProvider, TranslationService],
  exports: [TtsService],
})
export class TtsModule {}
