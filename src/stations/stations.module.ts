import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { StationsController } from './stations.controller';
import { StationsService } from './services/stations.service';
import { SeoulApiService } from './services/seoul-api.service';
import { StationSyncService } from './services/station-sync.service';
import { StationRealtimeService } from './services/station-realtime.service';
import { StationQueryService } from './services/station-query.service';
import { StationManagementService } from './services/station-management.service';
import { Station } from './entities/station.entity';
import { SyncLog } from './entities/sync-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Station, SyncLog]),
    HttpModule,
    ConfigModule,
  ],
  controllers: [StationsController],
  providers: [
    StationsService,
    SeoulApiService,
    StationSyncService,
    StationRealtimeService,
    StationQueryService,
    StationManagementService,
  ],
  exports: [StationsService, SeoulApiService],
})
export class StationsModule {}
