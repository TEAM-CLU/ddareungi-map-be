import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Station } from '../entities/station.entity';
import { SyncLog, SyncStatus, SyncType } from '../entities/sync-log.entity';
import { SeoulApiService } from './seoul-api.service';
import {
  CreateStationDto,
  StationResponseDto,
  SeoulBikeStationInfo,
  StationRawQueryResult,
  mapRawQueryToStationResponse,
  SeoulBikeRealtimeInfo,
} from '../dto/station.dto';
import type { Point } from 'geojson';
import {
  SyncResult,
  RealtimeUpdateData,
  SyncRealtimeDetail,
  DeleteAllResult,
} from '../interfaces/station.interfaces';

// 상수 정의
const SYNC_CONSTANTS = {
  WEEK_IN_MS: 7 * 24 * 60 * 60 * 1000,
  NEARBY_STATIONS_LIMIT: 3,
  DELETE_CONFIRM_KEY: 'DELETE_ALL_STATIONS_CONFIRM',
} as const;

@Injectable()
export class StationsService implements OnModuleInit {
  private readonly logger = new Logger(StationsService.name);

  constructor(
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    @InjectRepository(SyncLog)
    private readonly syncLogRepository: Repository<SyncLog>,
    private readonly seoulApiService: SeoulApiService,
  ) {}

  /**
   * 서버 시작 시 동기화 필요 여부 확인 및 실행
   */
  async onModuleInit() {
    this.logger.log('서버 시작 - 동기화 상태 확인 중...');

    try {
      const needsSync = await this.checkIfSyncNeeded();

      if (needsSync) {
        this.logger.log('동기화가 필요합니다. 자동 동기화를 시작합니다.');
        await this.performSync(SyncType.STARTUP_CHECK);
      } else {
        this.logger.log('최근에 동기화되었습니다. 스킵합니다.');
      }
    } catch (error) {
      this.logger.error('서버 시작 시 동기화 상태 확인 실패:', error);
    }
  }

  /**
   * 동기화 필요 여부 확인
   */
  private async checkIfSyncNeeded(): Promise<boolean> {
    const lastSuccessSync = await this.syncLogRepository.findOne({
      where: { status: SyncStatus.COMPLETED },
      order: { completed_at: 'DESC' },
    });

    if (!lastSuccessSync) {
      this.logger.log('이전 동기화 기록이 없습니다.');
      return true;
    }

    const oneWeekAgo = new Date(Date.now() - SYNC_CONSTANTS.WEEK_IN_MS);
    const isStale = lastSuccessSync.completed_at! < oneWeekAgo;

    this.logger.log(
      `마지막 성공 동기화: ${lastSuccessSync.completed_at?.toISOString()}, 일주일 경과 여부: ${isStale}`,
    );

    return isStale;
  }

  /**
   * 실제 동기화 수행 (통합 메서드)
   */
  private async performSync(syncType: SyncType): Promise<SyncResult> {
    const syncLog = await this.createSyncLog(syncType);
    try {
      const syncResult = await this.executeSyncProcess(syncType);
      await this.completeSyncLog(syncLog, syncResult);

      this.logger.log(
        `[${syncType}] 동기화 완료 - 생성: ${syncResult.created}, 업데이트: ${syncResult.updated}, 실패: ${syncResult.failed}, 총: ${syncResult.total}`,
      );

      return syncResult;
    } catch (error) {
      await this.failSyncLog(
        syncLog,
        { created: 0, updated: 0, failed: 0, total: 0 },
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
  private async executeSyncProcess(syncType: SyncType): Promise<SyncResult> {
    this.logger.log(`[${syncType}] 서울시 API에서 대여소 데이터 조회 중...`);

    const seoulStations = await this.seoulApiService.fetchAllStations();
    const total = seoulStations.length;

    this.logger.log(`[${syncType}] ${total}개 대여소 데이터 동기화 시작`);

    let created = 0;
    let updated = 0;
    let failed = 0;

    for (const seoulStation of seoulStations) {
      try {
        const result = await this.syncSingleStation(seoulStation);
        if (result === 'created') created++;
        else if (result === 'updated') updated++;
      } catch (error) {
        failed++;
        this.logger.warn(`대여소 ${seoulStation.RENT_ID} 동기화 실패:`, error);
      }
    }

    return { created, updated, failed, total };
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
    syncLog.stations_total = result.total;
    syncLog.stations_created = result.created;
    syncLog.stations_updated = result.updated;
    syncLog.stations_failed = result.failed;

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
    syncLog.stations_total = result.total;
    syncLog.stations_created = result.created;
    syncLog.stations_updated = result.updated;
    syncLog.stations_failed = result.failed;
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
      where: { station_id: seoulStation.RENT_ID },
    });

    const stationData = {
      station_id: seoulStation.RENT_ID,
      station_name: seoulStation.RENT_NM,
      station_number: seoulStation.RENT_NO,
      district: seoulStation.STA_LOC,
      address: `${seoulStation.STA_ADD1} ${seoulStation.STA_ADD2}`.trim(),
      total_racks: seoulStation.HOLD_NUM
        ? parseInt(seoulStation.HOLD_NUM, 10)
        : 0,
      location: {
        type: 'Point',
        coordinates: [
          parseFloat(
            seoulStation.STA_LONG && seoulStation.STA_LONG !== '0.00000000'
              ? seoulStation.STA_LONG
              : '0',
          ),
          parseFloat(
            seoulStation.STA_LAT && seoulStation.STA_LAT !== '0.00000000'
              ? seoulStation.STA_LAT
              : '0',
          ),
        ],
      } as Point,
      last_updated_at: new Date(),
    };

    if (existingStation) {
      // 기존 대여소 정보 업데이트
      await this.stationRepository.update(
        { station_id: seoulStation.RENT_ID },
        stationData,
      );
      return 'updated';
    } else {
      // 새로운 대여소 추가
      const newStation = this.stationRepository.create({
        ...stationData,
        current_adult_bikes: 0, // 초기값
      });

      await this.stationRepository.save(newStation);
      return 'created';
    }
  }

  /**
   * 동기화 상태 조회 (헬스체크용)
   */
  async getSyncStatus() {
    const latestSync = await this.syncLogRepository.findOne({
      order: { started_at: 'DESC' },
    });

    const lastSuccessSync = await this.syncLogRepository.findOne({
      where: { status: SyncStatus.COMPLETED },
      order: { completed_at: 'DESC' },
    });

    const needsSync = await this.checkIfSyncNeeded();

    return {
      latestSync,
      lastSuccessSync,
      needsSync,
      isOverdue: needsSync,
    };
  }

  /**
   * 공통 select 절을 가진 쿼리 빌더 생성
   */
  private createBaseStationQuery() {
    return this.stationRepository
      .createQueryBuilder('station')
      .select([
        'station.station_id as station_id',
        'station.station_name as station_name',
        'station.station_number as station_number',
        'station.district as district',
        'station.address as address',
        'station.total_racks as total_racks',
        'station.current_adult_bikes as current_adult_bikes',
        'station.last_updated_at as last_updated_at',
        'ST_X(station.location::geometry) as longitude',
        'ST_Y(station.location::geometry) as latitude',
      ]);
  }

  /**
   * 위치 기반 가장 가까운 대여소 3개 검색 - 실시간 정보 포함
   */
  async findNearbyStations(
    latitude: number,
    longitude: number,
  ): Promise<StationResponseDto[]> {
    this.logger.log(`근처 대여소 검색: lat=${latitude}, lng=${longitude}`);

    const query = this.createBaseStationQuery()
      .addSelect(
        'ST_Distance(station.location, ST_MakePoint(:longitude, :latitude)::geography) as distance',
      )
      .setParameters({ longitude, latitude })
      .orderBy('distance', 'ASC')
      .limit(SYNC_CONSTANTS.NEARBY_STATIONS_LIMIT);

    const rawResults = await query.getRawMany();
    const stationResults = rawResults.map((row: StationRawQueryResult) =>
      mapRawQueryToStationResponse(row),
    );

    // 실시간 대여정보 동기화
    await this.syncRealtimeInfoForStations(stationResults);

    this.logger.log(
      `근처 대여소 ${stationResults.length}개 반환 (실시간 정보 포함)`,
    );
    return stationResults;
  }

  /**
   * 모든 대여소 조회
   */
  async findAll(): Promise<StationResponseDto[]> {
    const stations = await this.createBaseStationQuery().getRawMany();

    return stations.map((row: StationRawQueryResult) =>
      mapRawQueryToStationResponse(row),
    );
  }

  /**
   * 대여소 ID로 조회
   */
  async findOne(stationId: string): Promise<StationResponseDto | null> {
    const result = (await this.createBaseStationQuery()
      .where('station.station_id = :stationId', { stationId })
      .getRawOne()) as StationRawQueryResult | null;

    if (!result) {
      return null;
    }

    return mapRawQueryToStationResponse(result);
  }

  /**
   * 대여소 생성 (수동)
   */
  async create(
    createStationDto: CreateStationDto,
  ): Promise<StationResponseDto> {
    const location: Point = {
      type: 'Point',
      coordinates: [createStationDto.longitude, createStationDto.latitude],
    };

    const station = this.stationRepository.create({
      ...createStationDto,
      location,
      last_updated_at: new Date(),
    });

    const savedStation = await this.stationRepository.save(station);

    return {
      station_id: savedStation.station_id,
      station_name: savedStation.station_name,
      station_number: savedStation.station_number,
      district: savedStation.district,
      address: savedStation.address,
      latitude: createStationDto.latitude,
      longitude: createStationDto.longitude,
      total_racks: savedStation.total_racks,
      current_adult_bikes: savedStation.current_adult_bikes,
      last_updated_at: savedStation.last_updated_at,
    };
  }

  /**
   * 지도 영역 내 모든 대여소 조회 - 실시간 정보 포함
   */
  async findStationsInMapArea(
    latitude: number,
    longitude: number,
    radius: number,
  ): Promise<StationResponseDto[]> {
    this.logger.log(
      `지도 영역 내 대여소 검색: lat=${latitude}, lng=${longitude}, radius=${radius}m`,
    );

    const query = this.createBaseStationQuery()
      .addSelect(
        'ST_Distance(station.location, ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)) as distance',
      )
      .where(
        'ST_DWithin(station.location, ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326), :radius)',
      )
      .orderBy('distance', 'ASC')
      .setParameters({
        latitude,
        longitude,
        radius,
      });

    const rawResults = await query.getRawMany();
    const stationResults = rawResults.map((row: StationRawQueryResult) =>
      mapRawQueryToStationResponse(row),
    );

    // 실시간 대여정보 동기화
    await this.syncRealtimeInfoForStations(stationResults);

    this.logger.log(
      `지도 영역 내 대여소 ${stationResults.length}개 반환 (실시간 정보 포함)`,
    );

    return stationResults;
  }

  /**
   * 대여소 삭제
   */
  async remove(stationId: string): Promise<void> {
    const result = await this.stationRepository.delete({
      station_id: stationId,
    });

    if (result.affected === 0) {
      throw new Error(`대여소 ID ${stationId}를 찾을 수 없습니다.`);
    }
  }

  /**
   * 모든 대여소 삭제 (관리자용 - 주의 필요)
   */
  async removeAll(confirmKey: string): Promise<DeleteAllResult> {
    // 안전 확인 키 검증
    if (confirmKey !== SYNC_CONSTANTS.DELETE_CONFIRM_KEY) {
      throw new Error('잘못된 확인 키입니다. 전체 삭제 작업이 취소되었습니다.');
    }

    this.logger.warn('🚨 전체 대여소 삭제 작업 시작');

    try {
      // 현재 대여소 수 확인
      const currentCount = await this.stationRepository.count();
      this.logger.log(`삭제 대상 대여소 수: ${currentCount}개`);

      if (currentCount === 0) {
        this.logger.log('삭제할 대여소가 없습니다.');
        return { deletedCount: 0 };
      }

      // 모든 대여소 삭제
      await this.stationRepository.clear();

      this.logger.warn(`✅ 전체 대여소 삭제 완료: ${currentCount}개 삭제됨`);

      return { deletedCount: currentCount };
    } catch (error) {
      this.logger.error('전체 대여소 삭제 실패:', error);
      throw new Error('전체 대여소 삭제 중 오류가 발생했습니다.');
    }
  }

  /**
   * 일주일에 한 번 서울시 따릉이 대여소 정보를 동기화합니다.
   * 매주 일요일 오전 2시에 실행됩니다.
   */
  @Cron('0 2 * * 0') // 매주 일요일 오전 2시
  async handleWeeklySync() {
    this.logger.log('주간 스케줄 동기화 시작');
    await this.performSync(SyncType.WEEKLY_AUTO);
  }

  /**
   * 수동 동기화 (API 호출용)
   */
  async syncStationsFromSeoulApi() {
    this.logger.log('수동 동기화 시작');
    return this.performSync(SyncType.MANUAL);
  }

  /**
   * 대여소 목록의 실시간 정보 동기화
   */
  private async syncRealtimeInfoForStations(
    stations: StationResponseDto[],
  ): Promise<void> {
    if (stations.length === 0) {
      return;
    }

    try {
      this.logger.log(`실시간 정보 동기화 시작: ${stations.length}개 대여소`);

      // 스테이션 ID 추출
      const stationIds = stations
        .map((station) => station.station_id)
        .filter((id): id is string => !!id);

      // ID 전용 메서드 호출
      const realtimeInfoMap = await this.syncRealtimeInfoByIds(stationIds);

      // 응답 데이터 업데이트
      for (const station of stations) {
        if (!station.station_id) continue;

        const realtimeInfo = realtimeInfoMap.get(station.station_id);
        if (!realtimeInfo) continue;

        // 응답 객체에 실시간 정보 반영
        station.current_adult_bikes =
          parseInt(realtimeInfo.parkingBikeTotCnt) || 0;
        station.total_racks = parseInt(realtimeInfo.rackTotCnt) || 0;
        station.last_updated_at = new Date();
      }

      this.logger.log(
        `실시간 정보 동기화 완료: ${realtimeInfoMap.size}/${stationIds.length}개 성공`,
      );
    } catch (error) {
      this.logger.error('실시간 정보 동기화 중 오류 발생:', error);
      // 오류가 발생해도 메인 로직을 방해하지 않도록 throw 하지 않음
    }
  }

  /**
   * 실시간 정보로 데이터베이스 업데이트용 데이터 생성
   */
  private createRealtimeUpdateData(
    realtimeInfo: SeoulBikeRealtimeInfo,
  ): RealtimeUpdateData {
    return {
      current_adult_bikes: parseInt(realtimeInfo.parkingBikeTotCnt) || 0,
      total_racks: parseInt(realtimeInfo.rackTotCnt) || 0,
      last_updated_at: new Date(),
    };
  }

  /**
   * ID 기반 실시간 정보 동기화 (순수 동기화 로직)
   */
  private async syncRealtimeInfoByIds(
    stationIds: string[],
  ): Promise<Map<string, SeoulBikeRealtimeInfo>> {
    if (stationIds.length === 0) {
      return new Map();
    }

    try {
      this.logger.log(`ID 기반 실시간 동기화: ${stationIds.length}개 대여소`);

      // 실시간 정보 조회
      const realtimeInfoMap =
        await this.seoulApiService.fetchMultipleRealtimeStationInfo(stationIds);

      // 데이터베이스 업데이트만 수행
      for (const [stationId, realtimeInfo] of realtimeInfoMap.entries()) {
        try {
          const updateData = this.createRealtimeUpdateData(realtimeInfo);
          await this.stationRepository.update(
            { station_id: stationId },
            updateData,
          );
        } catch (error) {
          this.logger.warn(`대여소 ${stationId} DB 업데이트 실패:`, error);
        }
      }

      return realtimeInfoMap;
    } catch (error) {
      this.logger.error('ID 기반 실시간 동기화 실패:', error);
      return new Map();
    }
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
    try {
      this.logger.log(`단일 대여소 실시간 정보 동기화: ${stationId}`);

      // 실시간 정보 조회
      const realtimeInfo =
        await this.seoulApiService.fetchRealtimeStationInfo(stationId);

      if (!realtimeInfo) {
        this.logger.warn(
          `대여소 ${stationId}의 실시간 정보를 찾을 수 없습니다.`,
        );
        return null;
      }

      // 데이터베이스 업데이트
      const updateData = this.createRealtimeUpdateData(realtimeInfo);
      const updateResult = await this.stationRepository.update(
        { station_id: stationId },
        updateData,
      );

      if (updateResult.affected === 0) {
        this.logger.warn(
          `대여소 ${stationId}를 데이터베이스에서 찾을 수 없습니다.`,
        );
        return null;
      }

      const result = {
        stationId: stationId,
        parkingBikeTotCnt: parseInt(realtimeInfo.parkingBikeTotCnt) || 0,
        rackTotCnt: parseInt(realtimeInfo.rackTotCnt) || 0,
        updatedAt: new Date(),
      };

      this.logger.log(`대여소 ${stationId} 실시간 정보 동기화 완료`);
      return result;
    } catch (error) {
      this.logger.error(`대여소 ${stationId} 실시간 정보 동기화 실패:`, error);
      throw error;
    }
  }

  /**
   * 전체 대여소 실시간 정보 동기화 (개발/테스트 용도)
   */
  async syncAllStationsRealtimeInfo(): Promise<{
    successCount: number;
    failureCount: number;
    details: SyncRealtimeDetail[];
  }> {
    try {
      this.logger.log('전체 대여소 실시간 정보 동기화 시작');

      // 모든 대여소 조회
      const allStations = await this.stationRepository.find({
        select: ['station_id', 'station_name'],
        where: { station_id: Not(IsNull()) },
      });

      const stationIds = allStations
        .map((station) => station.station_id)
        .filter((id): id is string => !!id);

      if (stationIds.length === 0) {
        return { successCount: 0, failureCount: 0, details: [] };
      }

      // ID 기반 동기화 메서드 사용
      const realtimeInfoMap = await this.syncRealtimeInfoByIds(stationIds);

      let successCount = 0;
      let failureCount = 0;
      const details: SyncRealtimeDetail[] = [];

      // 결과 집계
      for (const station of allStations) {
        if (!station.station_id) continue;

        const realtimeInfo = realtimeInfoMap.get(station.station_id);
        if (realtimeInfo) {
          successCount++;
          details.push({
            stationId: station.station_id,
            stationName: station.station_name,
            status: 'success',
            parkingBikeTotCnt: parseInt(realtimeInfo.parkingBikeTotCnt) || 0,
            rackTotCnt: parseInt(realtimeInfo.rackTotCnt) || 0,
          });
        } else {
          failureCount++;
          details.push({
            stationId: station.station_id,
            stationName: station.station_name,
            status: 'failed',
            error: '실시간 정보 없음',
          });
        }
      }

      this.logger.log(
        `전체 대여소 실시간 정보 동기화 완료: 성공 ${successCount}개, 실패 ${failureCount}개`,
      );

      return { successCount, failureCount, details };
    } catch (error) {
      this.logger.error('전체 대여소 실시간 정보 동기화 실패:', error);
      throw error;
    }
  }
}
