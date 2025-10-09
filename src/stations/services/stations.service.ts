import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
} from '../dto/station.dto';
import type { Point } from 'geojson';

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

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const isStale = lastSuccessSync.completed_at! < oneWeekAgo;

    this.logger.log(
      `마지막 성공 동기화: ${lastSuccessSync.completed_at?.toISOString()}, 일주일 경과 여부: ${isStale}`,
    );

    return isStale;
  }

  /**
   * 실제 동기화 수행 (통합 메서드)
   */
  private async performSync(syncType: SyncType) {
    // 동기화 로그 시작
    const syncLog = this.syncLogRepository.create({
      sync_type: syncType,
      status: SyncStatus.RUNNING,
    });
    await this.syncLogRepository.save(syncLog);

    let created = 0;
    let updated = 0;
    let failed = 0;
    let total = 0;

    try {
      this.logger.log(`[${syncType}] 서울시 API에서 대여소 데이터 조회 중...`);

      const seoulStations = await this.seoulApiService.fetchAllStations();
      total = seoulStations.length;

      this.logger.log(`[${syncType}] ${total}개 대여소 데이터 동기화 시작`);

      for (const seoulStation of seoulStations) {
        try {
          const result = await this.syncSingleStation(seoulStation);
          if (result === 'created') created++;
          else if (result === 'updated') updated++;
        } catch (error) {
          failed++;
          this.logger.warn(
            `대여소 ${seoulStation.RENT_ID} 동기화 실패:`,
            error,
          );
        }
      }

      // 성공 완료
      syncLog.status = SyncStatus.COMPLETED;
      syncLog.completed_at = new Date();
      syncLog.stations_total = total;
      syncLog.stations_created = created;
      syncLog.stations_updated = updated;
      syncLog.stations_failed = failed;

      await this.syncLogRepository.save(syncLog);

      const result = { created, updated, failed, total };

      this.logger.log(
        `[${syncType}] 동기화 완료 - 생성: ${created}, 업데이트: ${updated}, 실패: ${failed}, 총: ${total}`,
      );

      return result;
    } catch (error) {
      // 실패 처리
      syncLog.status = SyncStatus.FAILED;
      syncLog.completed_at = new Date();
      syncLog.stations_total = total;
      syncLog.stations_created = created;
      syncLog.stations_updated = updated;
      syncLog.stations_failed = failed;
      syncLog.error_message =
        error instanceof Error ? error.message : '알 수 없는 오류';

      await this.syncLogRepository.save(syncLog);

      this.logger.error(`[${syncType}] 동기화 실패:`, error);
      throw error;
    }
  }

  /**
   * 개별 대여소 동기화
   */
  private async syncSingleStation(
    seoulStation: SeoulBikeStationInfo,
  ): Promise<'created' | 'updated'> {
    const stationId = `ST-${seoulStation.RENT_ID}`;

    const existingStation = await this.stationRepository.findOne({
      where: { station_id: stationId },
    });

    const stationData = {
      station_id: stationId,
      external_station_id: seoulStation.RENT_ID,
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
          seoulStation.STA_LONG && seoulStation.STA_LONG !== '0.00000000'
            ? seoulStation.STA_LONG
            : '0',
          seoulStation.STA_LAT && seoulStation.STA_LAT !== '0.00000000'
            ? seoulStation.STA_LAT
            : '0',
        ],
      } as Point,
      last_updated_at: new Date(),
    };

    if (existingStation) {
      // 기존 대여소 정보 업데이트
      await this.stationRepository.update(
        { station_id: stationId },
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
   * 위치 기반 가장 가까운 대여소 3개 검색
   */
  async findNearbyStations(
    latitude: number,
    longitude: number,
  ): Promise<StationResponseDto[]> {
    const query = this.stationRepository
      .createQueryBuilder('station')
      .select([
        'station.station_id',
        'station.external_station_id',
        'station.station_name',
        'station.station_number',
        'station.district',
        'station.address',
        'station.total_racks',
        'station.current_adult_bikes',
        'station.last_updated_at',
        'ST_X(station.location::geometry) as longitude',
        'ST_Y(station.location::geometry) as latitude',
        'ST_Distance(station.location, ST_MakePoint(:longitude, :latitude)::geography) as distance',
      ])
      .setParameters({ longitude, latitude })
      .orderBy('distance', 'ASC')
      .limit(3);

    const rawResults = await query.getRawMany();

    return rawResults.map((row: StationRawQueryResult) =>
      mapRawQueryToStationResponse(row),
    );
  }

  /**
   * 모든 대여소 조회
   */
  async findAll(): Promise<StationResponseDto[]> {
    const stations = await this.stationRepository
      .createQueryBuilder('station')
      .select([
        'station.station_id',
        'station.external_station_id',
        'station.station_name',
        'station.station_number',
        'station.district',
        'station.address',
        'station.total_racks',
        'station.current_adult_bikes',
        'station.last_updated_at',
        'ST_X(station.location::geometry) as longitude',
        'ST_Y(station.location::geometry) as latitude',
      ])
      .getRawMany();

    return stations.map((row: StationRawQueryResult) =>
      mapRawQueryToStationResponse(row),
    );
  }

  /**
   * 대여소 ID로 조회
   */
  async findOne(stationId: string): Promise<StationResponseDto | null> {
    const result = (await this.stationRepository
      .createQueryBuilder('station')
      .select([
        'station.station_id',
        'station.external_station_id',
        'station.station_name',
        'station.station_number',
        'station.district',
        'station.address',
        'station.total_racks',
        'station.current_adult_bikes',
        'station.last_updated_at',
        'ST_X(station.location::geometry) as longitude',
        'ST_Y(station.location::geometry) as latitude',
      ])
      .where('station.station_id = :stationId', { stationId })
      .getRawOne()) as StationRawQueryResult | null;

    if (!result) {
      return null;
    }

    return mapRawQueryToStationResponse(result);
  }

  /**
   * 서울시 API 데이터를 Station entity 형식으로 변환
   */
  private mapSeoulApiToStation(
    seoulStation: SeoulBikeStationInfo,
  ): Partial<Station> {
    const location: Point = {
      type: 'Point',
      coordinates: [seoulStation.STA_LONG, seoulStation.STA_LAT],
    };

    const address = [seoulStation.STA_ADD1, seoulStation.STA_ADD2]
      .filter(Boolean)
      .join(' ');

    return {
      external_station_id: seoulStation.RENT_ID,
      station_name: seoulStation.RENT_NM,
      station_number: seoulStation.RENT_NO,
      district: seoulStation.STA_LOC,
      address: address || null,
      location,
      total_racks: seoulStation.HOLD_NUM || 0,
      current_adult_bikes: 0, // 실시간 데이터는 별도 API에서 가져와야 함
    };
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
      external_station_id: savedStation.external_station_id,
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
   * 지도 영역 내 모든 대여소 조회
   */
  async findStationsInMapArea(
    latitude: number,
    longitude: number,
    radius: number,
  ): Promise<StationResponseDto[]> {
    this.logger.log(
      `지도 영역 내 대여소 검색: lat=${latitude}, lng=${longitude}, radius=${radius}m`,
    );

    const query = this.stationRepository
      .createQueryBuilder('station')
      .select([
        'station.station_id',
        'station.external_station_id',
        'station.station_name',
        'station.station_number',
        'station.district',
        'station.address',
        'ST_X(station.location::geometry) as longitude',
        'ST_Y(station.location::geometry) as latitude',
        'station.total_racks',
        'station.current_adult_bikes',
        'station.last_updated_at',
        'ST_Distance(station.location, ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)) as distance',
      ])
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

    this.logger.log(`지도 영역 내 대여소 ${rawResults.length}개 발견`);

    return rawResults.map((row: StationRawQueryResult) =>
      mapRawQueryToStationResponse(row),
    );
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
}
