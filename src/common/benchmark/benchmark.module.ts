import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BenchmarkController } from './benchmark.controller';
import { BenchmarkMetricsService } from './benchmark-metrics.service';
import { BenchmarkScenarioService } from './benchmark-scenario.service';
import { StationsModule } from '../../stations/stations.module';
import { RoutesModule } from '../../routes/routes.module';
import { NavigationModule } from '../../navigation/navigation.module';
import { AdminBasicAuthGuard } from '../guards/admin-basic-auth.guard';

@Global()
@Module({
  imports: [ConfigModule, StationsModule, RoutesModule, NavigationModule],
  controllers: [BenchmarkController],
  providers: [
    BenchmarkMetricsService,
    BenchmarkScenarioService,
    AdminBasicAuthGuard,
  ],
  exports: [BenchmarkMetricsService, BenchmarkScenarioService],
})
export class BenchmarkModule {}
