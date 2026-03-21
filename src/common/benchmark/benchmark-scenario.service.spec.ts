import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BenchmarkScenarioService } from './benchmark-scenario.service';
import { StationQueryService } from '../../stations/services/station-query.service';
import { StationRealtimeService } from '../../stations/services/station-realtime.service';
import { RoutesService } from '../../routes/routes.service';
import { NavigationService } from '../../navigation/navigation.service';

describe('BenchmarkScenarioService', () => {
  let service: BenchmarkScenarioService;

  const stationQueryService = {
    findStationsInMapArea: jest.fn(),
  };

  const stationRealtimeService = {
    syncRealtimeInfoForStations: jest.fn(),
    syncRealtimeInfoByIds: jest.fn(),
    syncRealtimeInfoByIdsParallel: jest.fn(),
  };

  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'BENCHMARK_REALTIME_SYNC_CONCURRENCY') {
        return '8';
      }
      return undefined;
    }),
  };

  const routesService = {
    findFullJourney: jest.fn(),
  };

  const navigationService = {
    startNavigationSession: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BenchmarkScenarioService,
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: StationQueryService,
          useValue: stationQueryService,
        },
        {
          provide: StationRealtimeService,
          useValue: stationRealtimeService,
        },
        {
          provide: RoutesService,
          useValue: routesService,
        },
        {
          provide: NavigationService,
          useValue: navigationService,
        },
      ],
    }).compile();

    service = module.get(BenchmarkScenarioService);
  });

  it('should run map query scenario without realtime sync', async () => {
    stationQueryService.findStationsInMapArea.mockResolvedValue([
      { id: '1', number: '0001' },
      { id: '2', number: '0002' },
    ]);

    const result = await service.runMapQueryScenario({
      latitude: 37.1,
      longitude: 127.1,
      radius: 1000,
    });

    expect(result.stationCount).toBe(2);
    expect(result.stationIds).toEqual(['1', '2']);
    expect(
      stationRealtimeService.syncRealtimeInfoForStations,
    ).not.toHaveBeenCalled();
    expect(stationRealtimeService.syncRealtimeInfoByIds).not.toHaveBeenCalled();
    expect(
      stationRealtimeService.syncRealtimeInfoByIdsParallel,
    ).not.toHaveBeenCalled();
  });

  it('should run inline map sync scenario via station realtime service', async () => {
    const stations = [{ id: '1', number: '0001' }];
    stationQueryService.findStationsInMapArea.mockResolvedValue(stations);

    await service.runMapEndToEndScenario({
      latitude: 37.1,
      longitude: 127.1,
      radius: 1000,
      syncStrategy: 'inline',
    });

    expect(
      stationRealtimeService.syncRealtimeInfoForStations,
    ).toHaveBeenCalledWith(stations);
    expect(stationRealtimeService.syncRealtimeInfoByIds).not.toHaveBeenCalled();
    expect(
      stationRealtimeService.syncRealtimeInfoByIdsParallel,
    ).not.toHaveBeenCalled();
  });

  it('should run batch map sync scenario via station ids', async () => {
    stationQueryService.findStationsInMapArea.mockResolvedValue([
      { id: '1', number: '0001' },
      { id: '2', number: '0002' },
      { id: null, number: '0003' },
    ]);

    await service.runMapEndToEndScenario({
      latitude: 37.1,
      longitude: 127.1,
      radius: 1000,
      syncStrategy: 'batch',
    });

    expect(stationRealtimeService.syncRealtimeInfoByIds).toHaveBeenCalledWith([
      '1',
      '2',
    ]);
    expect(
      stationRealtimeService.syncRealtimeInfoForStations,
    ).not.toHaveBeenCalled();
    expect(
      stationRealtimeService.syncRealtimeInfoByIdsParallel,
    ).not.toHaveBeenCalled();
  });

  it('should run batch parallel map sync scenario via station ids', async () => {
    stationQueryService.findStationsInMapArea.mockResolvedValue([
      { id: '1', number: '0001' },
      { id: '2', number: '0002' },
    ]);

    await service.runMapEndToEndScenario({
      latitude: 37.1,
      longitude: 127.1,
      radius: 1000,
      syncStrategy: 'batch_parallel',
    });

    expect(
      stationRealtimeService.syncRealtimeInfoByIdsParallel,
    ).toHaveBeenCalledWith(['1', '2'], 8);
    expect(stationRealtimeService.syncRealtimeInfoByIds).not.toHaveBeenCalled();
    expect(
      stationRealtimeService.syncRealtimeInfoForStations,
    ).not.toHaveBeenCalled();
  });

  it('should create route and start navigation for tts scenario', async () => {
    routesService.findFullJourney.mockResolvedValue([{ routeId: 'route-1' }]);
    navigationService.startNavigationSession.mockResolvedValue({
      sessionId: 'session-1',
      instructions: [{ text: '직진' }],
      coordinates: [],
      segments: [],
      waypoints: [],
    });

    const result = await service.runNavigationScenario({
      start: { lat: 37.1, lng: 127.1 },
      end: { lat: 37.2, lng: 127.2 },
    });

    expect(result.routeId).toBe('route-1');
    expect(navigationService.startNavigationSession).toHaveBeenCalledWith(
      'route-1',
    );
  });
});
