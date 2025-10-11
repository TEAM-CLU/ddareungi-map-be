import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateStationDto, StationResponseDto } from '../dto/station.dto';
import {
  DeleteAllResult,
  GeoJSONFeatureCollection,
  SyncRealtimeDetail,
  SyncStatusInfo,
  SyncResult,
} from '../interfaces/station.interfaces';
import { SyncType } from '../entities/sync-log.entity';

// 분리된 서비스들
import { StationSyncService } from './station-sync.service';
import { StationRealtimeService } from './station-realtime.service';
import { StationQueryService } from './station-query.service';
import { StationManagementService } from './station-management.service';

@Injectable()
export class StationsService implements OnModuleInit {
  private readonly logger = new Logger(StationsService.name);

  constructor(
    private readonly stationSyncService: StationSyncService,
    private readonly stationRealtimeService: StationRealtimeService,
    private readonly stationQueryService: StationQueryService,
    private readonly stationManagementService: StationManagementService,
  ) {}

  /**
   * 서버 시작 시 동기화 필요 여부 확인 및 실행
   */
  async onModuleInit() {
    try {
      const needsSync = await this.stationSyncService.checkIfSyncNeeded();

      if (needsSync) {
        const result = await this.stationSyncService.performSync(
          SyncType.STARTUP_CHECK,
        );
        this.logger.log(
          `서버 시작 동기화 완료: 생성 ${result.created}개, 업데이트 ${result.updated}개`,
        );
      } else {
        this.logger.log('서버 시작: 최근 동기화 완료 상태 - 스킵');
      }
    } catch (error) {
      this.logger.error('서버 시작 동기화 실패:', error);
    }
  }

  // ==================== 동기화 관련 메서드 위임 ====================

  /**
   * 동기화 상태 조회 (헬스체크용)
   */
  async getSyncStatus(): Promise<SyncStatusInfo> {
    return this.stationSyncService.getSyncStatus();
  }

  /**
   * 수동 동기화 (API 호출용)
   */
  async syncStationsFromSeoulApi(): Promise<SyncResult> {
    return this.stationSyncService.syncStationsFromSeoulApi();
  }

  /**
   * 주간 동기화 처리 (수동 트리거용)
   */
  async handleWeeklySync(): Promise<void> {
    return this.stationSyncService.handleWeeklySync();
  }

  // ==================== 조회 관련 메서드 위임 ====================

  /**
   * 위치 기반 가장 가까운 대여소 3개 검색 - 실시간 정보 포함
   */
  async findNearbyStations(
    latitude: number,
    longitude: number,
  ): Promise<StationResponseDto[]> {
    return this.stationQueryService.findNearbyStations(latitude, longitude);
  }

  /**
   * 모든 대여소 조회
   */
  async findAll(): Promise<StationResponseDto[]> {
    return this.stationQueryService.findAll();
  }

  /**
   * 대여소 ID로 조회
   */
  async findOne(stationId: string): Promise<StationResponseDto | null> {
    return this.stationQueryService.findOne(stationId);
  }

  /**
   * 지도 영역 내 모든 대여소 조회 - 실시간 정보 포함
   */
  async findStationsInMapArea(
    latitude: number,
    longitude: number,
    radius: number,
  ): Promise<StationResponseDto[]> {
    return this.stationQueryService.findStationsInMapArea(
      latitude,
      longitude,
      radius,
    );
  }

  /**
   * StationResponseDto 배열을 GeoJSON FeatureCollection으로 변환
   */
  convertStationsToGeoJSON(
    stations: StationResponseDto[],
  ): GeoJSONFeatureCollection {
    return this.stationQueryService.convertStationsToGeoJSON(stations);
  }

  // ==================== 관리 관련 메서드 위임 ====================

  /**
   * 대여소 생성 (수동)
   */
  async create(
    createStationDto: CreateStationDto,
  ): Promise<StationResponseDto> {
    return this.stationManagementService.create(createStationDto);
  }

  /**
   * 대여소 삭제
   */
  async remove(stationId: string): Promise<void> {
    return this.stationManagementService.remove(stationId);
  }

  /**
   * 모든 대여소 삭제 (관리자용 - 주의 필요)
   */
  async removeAll(confirmKey: string): Promise<DeleteAllResult> {
    return this.stationManagementService.removeAll(confirmKey);
  }

  // ==================== 실시간 정보 관련 메서드 위임 ====================

  /**
   * 단일 대여소 실시간 정보 동기화
   */
  async syncSingleStationRealtimeInfo(stationId: string): Promise<{
    stationId: string;
    parkingBikeTotCnt: number;
    rackTotCnt: number;
    updatedAt: Date;
  } | null> {
    return this.stationRealtimeService.syncSingleStationRealtimeInfo(stationId);
  }

  /**
   * 전체 대여소 실시간 정보 동기화 (개발/테스트 용도)
   */
  async syncAllStationsRealtimeInfo(): Promise<{
    successCount: number;
    failureCount: number;
    details: SyncRealtimeDetail[];
  }> {
    return this.stationRealtimeService.syncAllStationsRealtimeInfo();
  }
}
