import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Station } from '../entities/station.entity';
import { SyncLog, SyncStatus, SyncType } from '../entities/sync-log.entity';
import { SeoulApiService } from './seoul-api.service';
import { SeoulBikeStationInfo } from '../dto/station.dto';
import { SyncResult } from '../interfaces/station.interfaces';
import type { Point } from 'geojson';

// 상수 정의
const SYNC_CONSTANTS = {
  WEEK_IN_MS: 7 * 24 * 60 * 60 * 1000,
} as const;

@Injectable()
export class StationSyncService {
  private readonly logger = new Logger(StationSyncService.name);

  constructor(
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    @InjectRepository(SyncLog)
    private readonly syncLogRepository: Repository<SyncLog>,
    private readonly seoulApiService: SeoulApiService,
  ) {}

  /**
   * 동기화 필요 여부 확인
   */
  async checkIfSyncNeeded(): Promise<boolean> {
    const lastSuccessSync = await this.syncLogRepository.findOne({
      where: { status: SyncStatus.COMPLETED },
      order: { completed_at: 'DESC' },
    });

    if (!lastSuccessSync) {
      return true;
    }

    const oneWeekAgo = new Date(Date.now() - SYNC_CONSTANTS.WEEK_IN_MS);
    return lastSuccessSync.completed_at! < oneWeekAgo;
  }

  /**
   * 실제 동기화 수행 (통합 메서드)
   */
  async performSync(syncType: SyncType): Promise<SyncResult> {
    const syncLog = await this.createSyncLog(syncType);
    try {
      const syncResult = await this.executeSyncProcess(syncType);
      await this.completeSyncLog(syncLog, syncResult);

      this.logger.log(
        `동기화 완료 [${syncType}]: 생성 ${syncResult.created}개, 업데이트 ${syncResult.updated}개 (총 ${syncResult.totalProcessed}개)`,
      );

      return syncResult;
    } catch (error) {
      await this.failSyncLog(
        syncLog,
        {
          totalProcessed: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: 0,
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
        error,
      );
      throw error;
    }
  }

  /**
   * 동기화 로그 생성
   */
  private async createSyncLog(syncType: SyncType): Promise<SyncLog> {
    const syncLog = this.syncLogRepository.create({
      sync_type: syncType,
      status: SyncStatus.RUNNING,
    });
    return await this.syncLogRepository.save(syncLog);
  }

  /**
   * 동기화 프로세스 실행
   */
  private async executeSyncProcess(_syncType: SyncType): Promise<SyncResult> {
    const startTime = Date.now();
    const seoulStations = await this.seoulApiService.fetchAllStations();

    let created = 0;
    let updated = 0;

    for (const seoulStation of seoulStations) {
      try {
        const result = await this.syncSingleStation(seoulStation);
        if (result === 'created') created++;
        else if (result === 'updated') updated++;
      } catch {
        this.logger.warn(`대여소 ${seoulStation.RENT_ID} 동기화 실패`);
      }
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    const totalProcessed = created + updated;

    return {
      totalProcessed,
      created,
      updated,
      skipped: 0,
      errors: 0,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      duration,
    };
  }

  /**
   * 동기화 완료 처리
   */
  private async completeSyncLog(
    syncLog: SyncLog,
    result: SyncResult,
  ): Promise<void> {
    syncLog.status = SyncStatus.COMPLETED;
    syncLog.completed_at = new Date();
    syncLog.stations_total = result.totalProcessed;
    syncLog.stations_created = result.created;
    syncLog.stations_updated = result.updated;

    await this.syncLogRepository.save(syncLog);
  }

  /**
   * 동기화 실패 처리
   */
  private async failSyncLog(
    syncLog: SyncLog,
    result: SyncResult,
    error: unknown,
  ): Promise<void> {
    syncLog.status = SyncStatus.FAILED;
    syncLog.completed_at = new Date();
    syncLog.stations_total = result.totalProcessed;
    syncLog.stations_created = result.created;
    syncLog.stations_updated = result.updated;
    syncLog.error_message =
      error instanceof Error ? error.message : '알 수 없는 오류';

    await this.syncLogRepository.save(syncLog);
    this.logger.error(`동기화 실패:`, error);
  }

  /**
   * 개별 대여소 동기화
   */
  private async syncSingleStation(
    seoulStation: SeoulBikeStationInfo,
  ): Promise<'created' | 'updated'> {
    const existingStation = await this.stationRepository.findOne({
      where: { id: seoulStation.RENT_ID },
    });

    const longitude = parseFloat(seoulStation.STA_LONG || '0');
    const latitude = parseFloat(seoulStation.STA_LAT || '0');

    // 유효하지 않은 좌표는 스키핑 (0.0 또는 NaN)
    const hasValidCoordinates =
      longitude !== 0 &&
      latitude !== 0 &&
      !isNaN(longitude) &&
      !isNaN(latitude) &&
      seoulStation.STA_LONG !== '0.00000000' &&
      seoulStation.STA_LAT !== '0.00000000';

    const stationData = {
      id: seoulStation.RENT_ID,
      name: seoulStation.RENT_NM,
      number: seoulStation.RENT_NO,
      district: seoulStation.STA_LOC,
      address: `${seoulStation.STA_ADD1} ${seoulStation.STA_ADD2}`.trim(),
      total_racks: seoulStation.HOLD_NUM
        ? parseInt(seoulStation.HOLD_NUM, 10)
        : 0,
      ...(hasValidCoordinates && {
        location: {
          type: 'Point',
          coordinates: [longitude, latitude],
        } as Point,
      }),
      last_updated_at: new Date(),
    };

    if (existingStation) {
      // 기존 대여소 정보 업데이트 (status는 실시간 동기화에서 처리)
      await this.stationRepository.update(
        { id: seoulStation.RENT_ID },
        stationData,
      );
      return 'updated';
    } else {
      // 새로운 대여소 추가
      const newStation = this.stationRepository.create({
        ...stationData,
        current_adult_bikes: 0, // 초기값
        status: 'empty', // 초기 상태
      });

      await this.stationRepository.save(newStation);
      return 'created';
    }
  }

  /**
   * 동기화 상태 조회 (헬스체크용)
   */
  async getSyncStatus(): Promise<{
    lastSyncAt: Date | null;
    totalStations: number;
    isHealthy: boolean;
    lastError?: string;
  }> {
    const latestSync = await this.syncLogRepository
      .createQueryBuilder('sync_log')
      .orderBy('sync_log.started_at', 'DESC')
      .getOne();

    const lastSuccessSync = await this.syncLogRepository.findOne({
      where: { status: SyncStatus.COMPLETED },
      order: { completed_at: 'DESC' },
    });

    return {
      lastSyncAt: latestSync?.completed_at || null,
      totalStations: await this.stationRepository.count(),
      isHealthy: lastSuccessSync !== null,
    };
  }

  /**
   * 수동 동기화 (API 호출용)
   */
  async syncStationsFromSeoulApi(): Promise<SyncResult> {
    return this.performSync(SyncType.MANUAL);
  }

  /**
   * 일주일에 한 번 서울시 따릉이 대여소 정보를 동기화합니다.
   * 매주 일요일 오전 2시에 실행됩니다.
   */
  @Cron('0 2 * * 0') // 매주 일요일 오전 2시
  async handleWeeklySync(): Promise<void> {
    await this.performSync(SyncType.WEEKLY_AUTO);
  }
}
