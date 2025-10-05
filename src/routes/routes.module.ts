import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { GraphHopperService } from './services/graphhopper.service';
import { RouteOptimizerService } from './services/route-optimizer.service';
import { RouteConverterService } from './services/route-converter.service';
import { StationMockService } from './services/station-mock.service';

@Module({
  imports: [
    HttpModule,
    // 실제 엔티티가 있다면 여기에 추가
    // TypeOrmModule.forFeature([Station]),
  ],
  controllers: [RoutesController],
  providers: [
    RoutesService,
    GraphHopperService,
    RouteOptimizerService,
    RouteConverterService,
    StationMockService,
  ],
})
export class RoutesModule {}
