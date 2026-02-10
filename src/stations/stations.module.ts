import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { StationsController } from './stations.controller';
import { StationsService } from './services/stations.service';
import { SeoulApiService } from './services/seoul-api.service';
import { StationSyncService } from './services/station-sync.service';
import { StationRealtimeService } from './services/station-realtime.service';
import { StationQueryService } from './services/station-query.service';
import { StationManagementService } from './services/station-management.service';
import { StationDomainService } from './services/station-domain.service';
import { StationMapperService } from './services/station-mapper.service';
import { StationSyncLockService } from './services/station-sync-lock.service';
import { Station } from './entities/station.entity';
import { SyncLog } from './entities/sync-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Station, SyncLog]), ConfigModule],
  controllers: [StationsController],
  providers: [
    StationsService,
    SeoulApiService,
    StationSyncService,
    StationSyncLockService,
    StationRealtimeService,
    StationQueryService,
    StationManagementService,
    StationDomainService,
    StationMapperService,
  ],
  exports: [
    StationsService,
    StationSyncService,
    StationQueryService,
    StationManagementService,
    StationRealtimeService,
    StationDomainService,
  ],
})
export class StationsModule {}
