import { Global, Module } from '@nestjs/common';
import { BenchmarkController } from './benchmark.controller';
import { BenchmarkMetricsService } from './benchmark-metrics.service';
import { BenchmarkScenarioService } from './benchmark-scenario.service';
import { StationsModule } from '../../stations/stations.module';
import { RoutesModule } from '../../routes/routes.module';
import { NavigationModule } from '../../navigation/navigation.module';

@Global()
@Module({
  imports: [StationsModule, RoutesModule, NavigationModule],
  controllers: [BenchmarkController],
  providers: [BenchmarkMetricsService, BenchmarkScenarioService],
  exports: [BenchmarkMetricsService, BenchmarkScenarioService],
})
export class BenchmarkModule {}
