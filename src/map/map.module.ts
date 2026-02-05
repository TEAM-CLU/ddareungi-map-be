import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MapController } from './map.controller';

@Module({
  imports: [ConfigModule],
  controllers: [MapController],
})
export class MapModule {}
