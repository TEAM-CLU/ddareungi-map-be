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
import { StationRealtimeLockService } from './services/station-realtime-lock.service';
import { StationBatchRealtimeSyncService } from './services/station-batch-realtime-sync.service';
import { StationRequestValidationService } from './services/station-request-validation.service';
import { StationReadFacadeService } from './services/station-read-facade.service';
import { AdminBasicAuthGuard } from '../common/guards/admin-basic-auth.guard';
import { Station } from './entities/station.entity';
import { SyncLog } from './entities/sync-log.entity';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Station, SyncLog]),
    ConfigModule,
    AnalyticsModule,
  ],
  controllers: [StationsController],
  providers: [
    StationsService,
    SeoulApiService,
    StationSyncService,
    StationRealtimeService,
    StationQueryService,
    StationManagementService,
    StationDomainService,
    StationMapperService,
    StationRealtimeLockService,
    StationBatchRealtimeSyncService,
    StationRequestValidationService,
    StationReadFacadeService,
    AdminBasicAuthGuard,
  ],
  exports: [
    StationsService,
    StationSyncService,
    StationQueryService,
    StationManagementService,
    StationRealtimeService,
    StationDomainService,
    StationRealtimeLockService,
    StationBatchRealtimeSyncService,
    StationRequestValidationService,
    StationReadFacadeService,
  ],
})
export class StationsModule {}
