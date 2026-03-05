import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 5000, // 5초 타임아웃 (프론트와 동일하게 설정)
      maxRedirects: 5,
    }),
  ],
  controllers: [LocationController],
  providers: [LocationService],
  exports: [LocationService],
})
export class LocationModule {}
