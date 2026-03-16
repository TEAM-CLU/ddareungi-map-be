import { Injectable } from '@nestjs/common';
import { RoutesService } from '../../routes/routes.service';
import { RouteDto } from '../../routes/dto/route.dto';
import { NavigationService } from '../../navigation/navigation.service';
import { NavigationSessionDto } from '../../navigation/dto/navigation.dto';
import { StationQueryService } from '../../stations/services/station-query.service';
import { StationRealtimeService } from '../../stations/services/station-realtime.service';
import {
  BenchmarkMapEndToEndDto,
  BenchmarkMapQueryDto,
} from './dto/benchmark-map-scenario.dto';
import { BenchmarkNavigationScenarioDto } from './dto/benchmark-navigation-scenario.dto';

@Injectable()
export class BenchmarkScenarioService {
  constructor(
    private readonly stationQueryService: StationQueryService,
    private readonly stationRealtimeService: StationRealtimeService,
    private readonly routesService: RoutesService,
    private readonly navigationService: NavigationService,
  ) {}

  async runMapQueryScenario(dto: BenchmarkMapQueryDto): Promise<{
    stationCount: number;
    stationIds: string[];
    stationNumbers: string[];
  }> {
    const stations = await this.stationQueryService.findStationsInMapArea(
      dto.latitude,
      dto.longitude,
      dto.radius,
    );

    return {
      stationCount: stations.length,
      stationIds: stations
        .map((station) => station.id)
        .filter((id): id is string => Boolean(id)),
      stationNumbers: stations
        .map((station) => station.number)
        .filter((number): number is string => Boolean(number)),
    };
  }

  async runMapEndToEndScenario(dto: BenchmarkMapEndToEndDto): Promise<{
    stationCount: number;
    stationIds: string[];
    stationNumbers: string[];
  }> {
    const stations = await this.stationQueryService.findStationsInMapArea(
      dto.latitude,
      dto.longitude,
      dto.radius,
    );

    if (dto.syncStrategy === 'inline') {
      await this.stationRealtimeService.syncRealtimeInfoForStations(stations);
    } else {
      const stationIds = stations
        .map((station) => station.id)
        .filter((id): id is string => Boolean(id));
      await this.stationRealtimeService.syncRealtimeInfoByIds(stationIds);
    }

    return {
      stationCount: stations.length,
      stationIds: stations
        .map((station) => station.id)
        .filter((id): id is string => Boolean(id)),
      stationNumbers: stations
        .map((station) => station.number)
        .filter((number): number is string => Boolean(number)),
    };
  }

  async runNavigationScenario(dto: BenchmarkNavigationScenarioDto): Promise<{
    routeId: string;
    route: RouteDto;
    navigation: NavigationSessionDto;
  }> {
    const routes = await this.routesService.findFullJourney(dto);
    const route = routes[0];

    if (!route?.routeId) {
      throw new Error('벤치마크용 routeId 생성에 실패했습니다.');
    }

    const navigation = await this.navigationService.startNavigationSession(
      route.routeId,
    );

    return {
      routeId: route.routeId,
      route,
      navigation,
    };
  }
}
