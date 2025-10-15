import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { GraphHopperService } from './services/graphhopper.service';
import { RouteOptimizerService } from './services/route-optimizer.service';
import { RouteConverterService } from './services/route-converter.service';
import { RouteBuilderService } from './services/route-builder.service';
import { StationRouteService } from './services/station-route.service';
import { RouteUtilService } from './services/route-util.service';
import { StationsModule } from '../stations/stations.module';

@Module({
  imports: [
    HttpModule,
    StationsModule, // StationQueryService를 사용하기 위해 추가
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
})
export class RoutesModule {}
