import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { Station } from '../entities/station.entity';
import { SeoulApiService } from './seoul-api.service';
import { StationResponseDto } from '../dto/station-api.dto';
import { SeoulBikeRealtimeInfo } from '../dto/station.dto';
import { StationDomainService } from './station-domain.service';
import { StationRealtimeLockService } from './station-realtime-lock.service';
import { StationRealtimeSyncResult } from '../interfaces/station.interfaces';
import { BenchmarkMetricsService } from '../../common/benchmark/benchmark-metrics.service';

@Injectable()
export class StationRealtimeService {
  private readonly logger = new Logger(StationRealtimeService.name);

  constructor(
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    private readonly seoulApiService: SeoulApiService,
    private readonly stationDomainService: StationDomainService,
    private readonly stationRealtimeLockService: StationRealtimeLockService,
    private readonly benchmarkMetricsService: BenchmarkMetricsService,
  ) {}

  private getErrorStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack : undefined;
  }

  /**
   * 대여소 목록의 실시간 정보 동기화
   */
  async syncRealtimeInfoForStations(
    stations: StationResponseDto[],
  ): Promise<void> {
    if (stations.length === 0) {
      return;
    }

    try {
      // 스테이션 ID 추출
      const stationIds = stations
        .map((station) => station.id)
        .filter((id): id is string => !!id);

      // ID 전용 메서드 호출
      const realtimeResults = await this.syncRealtimeInfoByIds(stationIds);

      // 응답 데이터 업데이트
      for (const station of stations) {
        if (!station.id) continue;

        const realtimeResult = realtimeResults.get(station.id);
        if (!realtimeResult || realtimeResult.outcome === 'not_found') {
          continue;
        }

        station.current_bikes = realtimeResult.current_bikes;
        station.total_racks = realtimeResult.total_racks;
        station.status = realtimeResult.status;
        station.last_updated_at = realtimeResult.last_updated_at;
      }

      const successfulCount = Array.from(realtimeResults.values()).filter(
        (result) => result.outcome !== 'not_found' && !result.error,
      ).length;
      this.logger.debug(
        `실시간 정보 동기화 완료: ${successfulCount}/${stations.length}개 성공`,
      );
    } catch (error) {
      this.logger.error('실시간 동기화 실패', this.getErrorStack(error));
      // 오류가 발생해도 메인 로직을 방해하지 않도록 throw 하지 않음
    }
  }

  /**
   * 실시간 정보로 데이터베이스 업데이트용 데이터 생성
   * StationDomainService 상태 계산 로직 사용
   */
  private createRealtimeUpdateData(realtimeInfo: SeoulBikeRealtimeInfo): {
    current_bikes: number;
    total_racks: number;
    status: Station['status'];
    last_updated_at: Date;
  } {
    const currentBikes = parseInt(realtimeInfo.parkingBikeTotCnt) || 0;
    const totalRacks = parseInt(realtimeInfo.rackTotCnt) || 0;
    const calculatedStatus = this.stationDomainService.calculateStationStatus(
      currentBikes,
      totalRacks,
      true,
    );

    return {
      current_bikes: currentBikes,
      total_racks: totalRacks,
      status: calculatedStatus,
      last_updated_at: new Date(),
    };
  }

  private async getStationSnapshot(stationId: string): Promise<{
    stationId: string;
    current_bikes: number;
    total_racks: number;
    status: Station['status'];
    last_updated_at: Date | null;
  } | null> {
    const station = await this.stationRepository.findOne({
      where: { id: stationId },
      select: {
        id: true,
        current_bikes: true,
        total_racks: true,
        status: true,
        last_updated_at: true,
      },
    });

    if (!station) {
      return null;
    }

    return {
      stationId: station.id,
      current_bikes: station.current_bikes,
      total_racks: station.total_racks,
      status: station.status,
      last_updated_at: station.last_updated_at,
    };
  }

  private createNotFoundResult(
    stationId: string,
    error?: string,
    usedLiveApi = false,
  ): StationRealtimeSyncResult {
    return {
      stationId,
      outcome: 'not_found',
      current_bikes: 0,
      total_racks: 0,
      status: 'inactive',
      last_updated_at: null,
      usedLiveApi,
      error,
    };
  }

  private createSnapshotResult(
    snapshot: {
      stationId: string;
      current_bikes: number;
      total_racks: number;
      status: Station['status'];
      last_updated_at: Date | null;
    },
    outcome: StationRealtimeSyncResult['outcome'],
    error?: string,
  ): StationRealtimeSyncResult {
    return {
      stationId: snapshot.stationId,
      outcome,
      current_bikes: snapshot.current_bikes,
      total_racks: snapshot.total_racks,
      status: snapshot.status,
      last_updated_at: snapshot.last_updated_at,
      usedLiveApi: outcome !== 'skipped_locked',
      error,
    };
  }

  private async buildLockedSnapshotResult(
    stationId: string,
  ): Promise<StationRealtimeSyncResult> {
    const snapshot = await this.getStationSnapshot(stationId);
    if (!snapshot) {
      return this.createNotFoundResult(stationId);
    }

    return {
      ...this.createSnapshotResult(snapshot, 'skipped_locked'),
      usedLiveApi: false,
    };
  }

  private async markStationInactive(
    stationId: string,
    error?: string,
  ): Promise<StationRealtimeSyncResult> {
    const lastUpdatedAt = new Date();
    const updateResult = await this.stationRepository.update(
      { id: stationId },
      {
        status: 'inactive',
        last_updated_at: lastUpdatedAt,
      },
    );

    if (updateResult.affected === 0) {
      return this.createNotFoundResult(stationId, error, true);
    }

    const snapshot = await this.getStationSnapshot(stationId);
    if (!snapshot) {
      return {
        stationId,
        outcome: 'inactive_no_data',
        current_bikes: 0,
        total_racks: 0,
        status: 'inactive',
        last_updated_at: lastUpdatedAt,
        usedLiveApi: true,
        error,
      };
    }

    return {
      ...this.createSnapshotResult(snapshot, 'inactive_no_data', error),
      usedLiveApi: true,
    };
  }

  private async syncStationRealtimeByIdWithLock(
    stationId: string,
  ): Promise<StationRealtimeSyncResult> {
    this.benchmarkMetricsService.increment('station_sync_requested_total');
    const lock = await this.stationRealtimeLockService.acquire(stationId);

    if (!lock) {
      this.logger.debug(`대여소 ${stationId} 실시간 락 충돌 - 기존 DB 값 사용`);
      return this.buildLockedSnapshotResult(stationId);
    }

    try {
      const realtimeInfo =
        await this.seoulApiService.fetchRealtimeStationInfo(stationId);

      if (!realtimeInfo) {
        this.logger.debug(`실시간 정보 없음: ${stationId} - inactive로 설정`);
        return this.markStationInactive(stationId);
      }

      const updateData = this.createRealtimeUpdateData(realtimeInfo);
      const updateResult = await this.stationRepository.update(
        { id: stationId },
        updateData,
      );

      if (updateResult.affected === 0) {
        this.logger.debug(`대여소 없음: ${stationId}`);
        return this.createNotFoundResult(stationId, undefined, true);
      }

      return {
        stationId,
        outcome: 'updated',
        current_bikes: updateData.current_bikes,
        total_racks: updateData.total_racks,
        status: updateData.status,
        last_updated_at: updateData.last_updated_at,
        usedLiveApi: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `실시간 동기화 실패: ${stationId}`,
        this.getErrorStack(error),
      );
      return this.markStationInactive(stationId, message);
    } finally {
      const released = await this.stationRealtimeLockService.release(lock);
      if (!released) {
        this.logger.debug(`대여소 ${stationId} 실시간 락 해제 스킵`);
      }
    }
  }

  /**
   * ID 기반 실시간 정보 동기화 (순수 동기화 로직)
   */
  public async syncRealtimeInfoByIds(
    stationIds: string[],
  ): Promise<Map<string, StationRealtimeSyncResult>> {
    const uniqueStationIds = this.normalizeStationIds(stationIds);
    if (uniqueStationIds.length === 0) {
      return new Map();
    }

    const results = new Map<string, StationRealtimeSyncResult>();

    for (let index = 0; index < uniqueStationIds.length; index++) {
      const stationId = uniqueStationIds[index];
      const result = await this.syncStationRealtimeByIdWithLock(stationId);
      results.set(stationId, result);

      if (result.usedLiveApi && index < uniqueStationIds.length - 1) {
        await this.seoulApiService.waitRealtimeApiDelay();
      }
    }

    return results;
  }

  public async syncRealtimeInfoByIdsParallel(
    stationIds: string[],
    concurrency = 8,
  ): Promise<Map<string, StationRealtimeSyncResult>> {
    const uniqueStationIds = this.normalizeStationIds(stationIds);
    if (uniqueStationIds.length === 0) {
      return new Map();
    }

    const workerCount = Math.min(
      uniqueStationIds.length,
      Math.max(1, Math.floor(concurrency)),
    );
    const resultsByIndex: Array<
      [string, StationRealtimeSyncResult] | undefined
    > = new Array(uniqueStationIds.length);
    let nextIndex = 0;

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;

          if (currentIndex >= uniqueStationIds.length) {
            return;
          }

          const stationId = uniqueStationIds[currentIndex];
          const result = await this.syncStationRealtimeByIdWithLock(stationId);
          resultsByIndex[currentIndex] = [stationId, result];
        }
      }),
    );

    return new Map(
      resultsByIndex.filter(
        (entry): entry is [string, StationRealtimeSyncResult] =>
          entry !== undefined,
      ),
    );
  }

  private normalizeStationIds(stationIds: string[]): string[] {
    return Array.from(new Set(stationIds.filter(Boolean)));
  }

  /**
   * 단일 대여소 실시간 정보 동기화
   */
  async syncSingleStationRealtimeInfo(stationId: string): Promise<{
    stationId: string;
    parkingBikeTotCnt: number;
    rackTotCnt: number;
    updatedAt: Date;
  } | null> {
    const result = await this.syncStationRealtimeByIdWithLock(stationId);

    if (result.error) {
      throw new Error(result.error);
    }

    if (
      result.outcome === 'not_found' ||
      result.outcome === 'inactive_no_data'
    ) {
      return null;
    }

    return {
      stationId: result.stationId,
      parkingBikeTotCnt: result.current_bikes,
      rackTotCnt: result.total_racks,
      updatedAt: result.last_updated_at ?? new Date(),
    };
  }

  /**
   * 전체 대여소 실시간 정보 동기화 (개발/테스트 용도)
   */
  async syncAllStationsRealtimeInfo(): Promise<{
    successCount: number;
    failureCount: number;
    details: Array<{
      stationId: string;
      success: boolean;
      error?: string;
    }>;
  }> {
    try {
      // 모든 대여소 조회
      const allStations = await this.stationRepository.find({
        select: ['id', 'name'],
        where: { id: Not(IsNull()) },
      });

      const stationIds = allStations
        .map((station) => station.id)
        .filter((id): id is string => !!id);

      if (stationIds.length === 0) {
        return { successCount: 0, failureCount: 0, details: [] };
      }

      // ID 기반 동기화 메서드 사용
      const realtimeResults = await this.syncRealtimeInfoByIds(stationIds);

      let successCount = 0;
      let failureCount = 0;
      const details: Array<{
        stationId: string;
        success: boolean;
        error?: string;
      }> = [];

      // 결과 집계
      for (const station of allStations) {
        if (!station.id) continue;

        const realtimeResult = realtimeResults.get(station.id);
        if (
          realtimeResult &&
          realtimeResult.outcome !== 'not_found' &&
          !realtimeResult.error
        ) {
          successCount++;
          details.push({
            stationId: station.id,
            success: true,
          });
        } else {
          failureCount++;
          details.push({
            stationId: station.id,
            success: false,
            error:
              realtimeResult?.error ||
              (realtimeResult?.outcome === 'not_found'
                ? '대여소 없음'
                : '실시간 정보 동기화 실패'),
          });
        }
      }

      this.logger.debug(
        `전체 실시간 동기화 완료: ${successCount}개 성공, ${failureCount}개 실패 (총 ${allStations.length}개)`,
      );

      return { successCount, failureCount, details };
    } catch (error) {
      this.logger.error('전체 실시간 동기화 실패', this.getErrorStack(error));
      throw error;
    }
  }
}
