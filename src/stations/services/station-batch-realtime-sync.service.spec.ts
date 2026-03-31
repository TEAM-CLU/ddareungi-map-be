import { StationQueryService } from './station-query.service';
import { StationRealtimeService } from './station-realtime.service';
import { StationBatchRealtimeSyncService } from './station-batch-realtime-sync.service';

describe('StationBatchRealtimeSyncService', () => {
  let service: StationBatchRealtimeSyncService;

  const stationQueryService = {
    findByNumber: jest.fn(),
  } as unknown as StationQueryService;

  const stationRealtimeService = {
    syncRealtimeInfoByIdsForOperations: jest.fn(),
  } as unknown as StationRealtimeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StationBatchRealtimeSyncService(
      stationQueryService,
      stationRealtimeService,
    );
  });

  it('should resolve station numbers to ids and use operational parallel sync', async () => {
    (stationQueryService.findByNumber as jest.Mock)
      .mockResolvedValueOnce({ id: 'station-1', number: '1001' })
      .mockResolvedValueOnce({ id: 'station-2', number: '1002' });
    (
      stationRealtimeService.syncRealtimeInfoByIdsForOperations as jest.Mock
    ).mockResolvedValue(
      new Map([
        [
          'station-1',
          {
            stationId: 'station-1',
            outcome: 'updated',
            current_bikes: 3,
            total_racks: 10,
            status: 'available',
            last_updated_at: new Date(),
            usedLiveApi: true,
          },
        ],
        [
          'station-2',
          {
            stationId: 'station-2',
            outcome: 'skipped_locked',
            current_bikes: 4,
            total_racks: 12,
            status: 'available',
            last_updated_at: new Date(),
            usedLiveApi: false,
          },
        ],
      ]),
    );

    const result = await service.syncByStationNumbers(['1001', '1002']);

    expect(stationQueryService.findByNumber).toHaveBeenCalledWith('1001');
    expect(stationQueryService.findByNumber).toHaveBeenCalledWith('1002');
    expect(
      stationRealtimeService.syncRealtimeInfoByIdsForOperations,
    ).toHaveBeenCalledWith(['station-1', 'station-2']);
    expect(result).toEqual({
      successCount: 2,
      failureCount: 0,
    });
  });

  it('should filter missing station numbers and preserve success-failure counting', async () => {
    (stationQueryService.findByNumber as jest.Mock)
      .mockResolvedValueOnce({ id: 'station-1', number: '1001' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'station-3', number: '1003' });
    (
      stationRealtimeService.syncRealtimeInfoByIdsForOperations as jest.Mock
    ).mockResolvedValue(
      new Map([
        [
          'station-1',
          {
            stationId: 'station-1',
            outcome: 'updated',
            current_bikes: 2,
            total_racks: 8,
            status: 'available',
            last_updated_at: new Date(),
            usedLiveApi: true,
          },
        ],
        [
          'station-3',
          {
            stationId: 'station-3',
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

    const result = await service.syncByStationNumbers(['1001', '9999', '1003']);

    expect(
      stationRealtimeService.syncRealtimeInfoByIdsForOperations,
    ).toHaveBeenCalledWith(['station-1', 'station-3']);
    expect(result).toEqual({
      successCount: 1,
      failureCount: 1,
    });
  });
});
