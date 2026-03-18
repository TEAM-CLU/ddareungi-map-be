import { Injectable } from '@nestjs/common';
import { StationQueryService } from './station-query.service';
import { StationRealtimeService } from './station-realtime.service';

type StationBatchRealtimeSyncResult = {
  successCount: number;
  failureCount: number;
};

@Injectable()
export class StationBatchRealtimeSyncService {
  constructor(
    private readonly stationQueryService: StationQueryService,
    private readonly stationRealtimeService: StationRealtimeService,
  ) {}

  async syncByStationNumbers(
    stationNumbers: string[],
  ): Promise<StationBatchRealtimeSyncResult> {
    const stationIds = (
      await Promise.all(
        stationNumbers.map(async (number) => {
          const station = await this.stationQueryService.findByNumber(number);
          return station ? String(station.id) : null;
        }),
      )
    ).filter((stationId): stationId is string => Boolean(stationId));

    const resultMap =
      await this.stationRealtimeService.syncRealtimeInfoByIds(stationIds);
    const results = Array.from(resultMap.values());
    const successCount = results.filter(
      (result) => result.outcome !== 'not_found' && !result.error,
    ).length;

    return {
      successCount,
      failureCount: results.length - successCount,
    };
  }
}
