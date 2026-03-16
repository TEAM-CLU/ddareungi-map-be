import { Repository } from 'typeorm';
import { Station } from '../entities/station.entity';
import { StationRealtimeService } from './station-realtime.service';
import { SeoulApiService } from './seoul-api.service';
import { StationDomainService } from './station-domain.service';
import { StationRealtimeLockService } from './station-realtime-lock.service';
import { BenchmarkMetricsService } from '../../common/benchmark/benchmark-metrics.service';

describe('StationRealtimeService', () => {
  let service: StationRealtimeService;
  const updateMock = jest.fn();
  const findOneMock = jest.fn();
  const findMock = jest.fn();
  const fetchRealtimeStationInfoMock = jest.fn();
  const waitRealtimeApiDelayMock = jest.fn();
  const calculateStationStatusMock = jest.fn();
  const acquireLockMock = jest.fn();
  const releaseLockMock = jest.fn();

  const stationRepository = {
    update: updateMock,
    findOne: findOneMock,
    find: findMock,
  } as unknown as Repository<Station>;

  const seoulApiService = {
    fetchRealtimeStationInfo: fetchRealtimeStationInfoMock,
    waitRealtimeApiDelay: waitRealtimeApiDelayMock,
  } as unknown as SeoulApiService;

  const stationDomainService = {
    calculateStationStatus: calculateStationStatusMock,
  } as unknown as StationDomainService;

  const stationRealtimeLockService = {
    acquire: acquireLockMock,
    release: releaseLockMock,
  } as unknown as StationRealtimeLockService;

  const benchmarkMetricsService = {
    increment: jest.fn(),
  } as unknown as BenchmarkMetricsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StationRealtimeService(
      stationRepository,
      seoulApiService,
      stationDomainService,
      stationRealtimeLockService,
      benchmarkMetricsService,
    );
  });

  it('should only call the live API once when the second request hits a lock', async () => {
    const snapshotDate = new Date('2026-03-16T00:00:00.000Z');

    acquireLockMock
      .mockResolvedValueOnce({
        key: 'station:realtime-sync:lock:ST-1',
        token: 'token-1',
      })
      .mockResolvedValueOnce(null);
    releaseLockMock.mockResolvedValue(true);
    fetchRealtimeStationInfoMock.mockResolvedValue({
      parkingBikeTotCnt: '5',
      rackTotCnt: '12',
    });
    calculateStationStatusMock.mockReturnValue('available');
    updateMock.mockResolvedValue({ affected: 1 });
    findOneMock.mockResolvedValue({
      id: 'ST-1',
      current_bikes: 5,
      total_racks: 12,
      status: 'available',
      last_updated_at: snapshotDate,
    });

    const first = await service.syncSingleStationRealtimeInfo('ST-1');
    const second = await service.syncSingleStationRealtimeInfo('ST-1');

    expect(first).not.toBeNull();
    expect(first?.stationId).toBe('ST-1');
    expect(first?.parkingBikeTotCnt).toBe(5);
    expect(first?.rackTotCnt).toBe(12);
    expect(first?.updatedAt).toBeInstanceOf(Date);
    expect(second).toEqual({
      stationId: 'ST-1',
      parkingBikeTotCnt: 5,
      rackTotCnt: 12,
      updatedAt: snapshotDate,
    });
    expect(fetchRealtimeStationInfoMock).toHaveBeenCalledTimes(1);
  });

  it('should reuse the DB snapshot when lock acquisition fails', async () => {
    const snapshotDate = new Date('2026-03-16T01:00:00.000Z');

    acquireLockMock.mockResolvedValue(null);
    findOneMock.mockResolvedValue({
      id: 'ST-2',
      current_bikes: 7,
      total_racks: 20,
      status: 'available',
      last_updated_at: snapshotDate,
    });

    const result = await service.syncSingleStationRealtimeInfo('ST-2');

    expect(result).toEqual({
      stationId: 'ST-2',
      parkingBikeTotCnt: 7,
      rackTotCnt: 20,
      updatedAt: snapshotDate,
    });
    expect(fetchRealtimeStationInfoMock).not.toHaveBeenCalled();
  });

  it('should apply skipped_locked results to DTOs and leave not_found entries unchanged', async () => {
    const snapshotDate = new Date('2026-03-16T02:00:00.000Z');
    const syncSpy = jest
      .spyOn(service, 'syncRealtimeInfoByIds')
      .mockResolvedValue(
        new Map([
          [
            'ST-1',
            {
              stationId: 'ST-1',
              outcome: 'skipped_locked',
              current_bikes: 9,
              total_racks: 15,
              status: 'available',
              last_updated_at: snapshotDate,
              usedLiveApi: false,
            },
          ],
          [
            'ST-2',
            {
              stationId: 'ST-2',
              outcome: 'not_found',
              current_bikes: 0,
              total_racks: 0,
              status: 'inactive',
              last_updated_at: null,
              usedLiveApi: false,
            },
          ],
        ]),
      );

    const stations = [
      {
        id: 'ST-1',
        name: 'A',
        number: '1',
        latitude: 0,
        longitude: 0,
        total_racks: 1,
        current_bikes: 1,
        status: 'empty' as const,
        last_updated_at: null,
      },
      {
        id: 'ST-2',
        name: 'B',
        number: '2',
        latitude: 0,
        longitude: 0,
        total_racks: 2,
        current_bikes: 2,
        status: 'available' as const,
        last_updated_at: null,
      },
    ];

    await service.syncRealtimeInfoForStations(stations);

    expect(syncSpy).toHaveBeenCalledWith(['ST-1', 'ST-2']);
    expect(stations[0]).toMatchObject({
      current_bikes: 9,
      total_racks: 15,
      status: 'available',
      last_updated_at: snapshotDate,
    });
    expect(stations[1]).toMatchObject({
      current_bikes: 2,
      total_racks: 2,
      status: 'available',
      last_updated_at: null,
    });
  });

  it('should count updated, inactive_no_data, and skipped_locked as success in batch sync', async () => {
    jest.spyOn(service, 'syncRealtimeInfoByIds').mockResolvedValue(
      new Map([
        [
          'ST-1',
          {
            stationId: 'ST-1',
            outcome: 'updated',
            current_bikes: 3,
            total_racks: 10,
            status: 'available',
            last_updated_at: new Date(),
            usedLiveApi: true,
          },
        ],
        [
          'ST-2',
          {
            stationId: 'ST-2',
            outcome: 'inactive_no_data',
            current_bikes: 0,
            total_racks: 12,
            status: 'inactive',
            last_updated_at: new Date(),
            usedLiveApi: true,
          },
        ],
        [
          'ST-3',
          {
            stationId: 'ST-3',
            outcome: 'skipped_locked',
            current_bikes: 5,
            total_racks: 14,
            status: 'available',
            last_updated_at: new Date(),
            usedLiveApi: false,
          },
        ],
        [
          'ST-4',
          {
            stationId: 'ST-4',
            outcome: 'not_found',
            current_bikes: 0,
            total_racks: 0,
            status: 'inactive',
            last_updated_at: null,
            usedLiveApi: false,
            error: '대여소 없음',
          },
        ],
      ]),
    );
    (stationRepository.find as jest.Mock).mockResolvedValue([
      { id: 'ST-1', name: 'A' },
      { id: 'ST-2', name: 'B' },
      { id: 'ST-3', name: 'C' },
      { id: 'ST-4', name: 'D' },
    ]);

    const result = await service.syncAllStationsRealtimeInfo();

    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(1);
    expect(result.details).toEqual(
      expect.arrayContaining([
        { stationId: 'ST-1', success: true },
        { stationId: 'ST-2', success: true },
        { stationId: 'ST-3', success: true },
        {
          stationId: 'ST-4',
          success: false,
          error: '대여소 없음',
        },
      ]),
    );
  });
});
