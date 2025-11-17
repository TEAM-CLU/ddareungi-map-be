import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { TtsService } from './tts.service';
import { TtsController } from './tts.controller';
import { GoogleTtsProvider } from './tts.provider';
import { TranslationService } from './translation.service';

@Module({
  imports: [ConfigModule, HttpModule],
  controllers: [TtsController],
  providers: [TtsService, GoogleTtsProvider, TranslationService],
  exports: [TtsService],
})
export class TtsModule {}
