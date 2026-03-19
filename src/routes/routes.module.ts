import { Module } from '@nestjs/common';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { GraphHopperService } from './services/graphhopper.service';
import { RouteOptimizerService } from './services/route-optimizer.service';
import { RouteConverterService } from './services/route-converter.service';
import { RouteBuilderService } from './services/route-builder.service';
import { StationRouteService } from './services/station-route.service';
import { RouteUtilService } from './services/route-util.service';
import { StationsModule } from '../stations/stations.module';
import { AnalyticsModule } from '../analytics/analytics.module';

import { RedisModule } from '@liaoliaots/nestjs-redis';

@Module({
  imports: [
    StationsModule, // StationQueryService를 사용하기 위해 추가
    RedisModule,
    AnalyticsModule,
  ],
  controllers: [RoutesController],
  providers: [
    RoutesService,
    GraphHopperService,
    RouteOptimizerService,
    RouteConverterService,
    RouteBuilderService,
    StationRouteService,
    RouteUtilService,
  ],
  exports: [
    RoutesService, // NavigationModule에서 사용
    GraphHopperService, // NavigationReturnService에서 사용
    StationRouteService, // NavigationRerouteService에서 출발 대여소 재탐색에 사용
  ],
})
export class RoutesModule {}
