import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { Station } from '../entities/station.entity';
import { SeoulApiService } from './seoul-api.service';
import { StationResponseDto, SeoulBikeRealtimeInfo } from '../dto/station.dto';
import {
  RealtimeUpdateData,
  SyncRealtimeDetail,
} from '../interfaces/station.interfaces';

@Injectable()
export class StationRealtimeService {
  private readonly logger = new Logger(StationRealtimeService.name);

  constructor(
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    private readonly seoulApiService: SeoulApiService,
  ) {}

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
      const realtimeInfoMap = await this.syncRealtimeInfoByIds(stationIds);

      // 응답 데이터 업데이트
      for (const station of stations) {
        if (!station.id) continue;

        const realtimeInfo = realtimeInfoMap.get(station.id);
        if (!realtimeInfo) continue;

        // 응답 객체에 실시간 정보 반영 (shared 필드 활용)
        const currentBikes = parseInt(realtimeInfo.parkingBikeTotCnt) || 0;
        const sharedRate = parseFloat(realtimeInfo.shared) || 0;

        station.current_adult_bikes = currentBikes;
        station.total_racks = parseInt(realtimeInfo.rackTotCnt) || 0;
        station.status = sharedRate > 0 ? 'available' : 'empty';
        station.last_updated_at = new Date();
      }

      this.logger.log(
        `실시간 정보 동기화 완료: ${realtimeInfoMap.size}/${stations.length}개 성공`,
      );
    } catch (error) {
      this.logger.error('실시간 동기화 실패:', error);
      // 오류가 발생해도 메인 로직을 방해하지 않도록 throw 하지 않음
    }
  }

  /**
   * 실시간 정보로 데이터베이스 업데이트용 데이터 생성
   * Seoul API의 shared 필드(거치율)를 활용하여 상태 결정
   */
  private createRealtimeUpdateData(
    realtimeInfo: SeoulBikeRealtimeInfo,
  ): RealtimeUpdateData {
    const currentBikes = parseInt(realtimeInfo.parkingBikeTotCnt) || 0;
    const sharedRate = parseFloat(realtimeInfo.shared) || 0; // 거치율

    // 거치율이 0%면 empty, 그 외에는 available
    const status: 'available' | 'empty' =
      sharedRate > 0 ? 'available' : 'empty';

    return {
      current_adult_bikes: currentBikes,
      total_racks: parseInt(realtimeInfo.rackTotCnt) || 0,
      status: status,
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
        } catch {
          this.logger.warn(`대여소 ${stationId} DB 업데이트 실패`);
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
      // 실시간 정보 조회
      const realtimeInfo =
        await this.seoulApiService.fetchRealtimeStationInfo(stationId);

      if (!realtimeInfo) {
        this.logger.warn(`실시간 정보 없음: ${stationId}`);
        return null;
      }

      // 데이터베이스 업데이트
      const updateData = this.createRealtimeUpdateData(realtimeInfo);
      const updateResult = await this.stationRepository.update(
        { station_id: stationId },
        updateData,
      );

      if (updateResult.affected === 0) {
        this.logger.warn(`대여소 없음: ${stationId}`);
        return null;
      }

      const result = {
        stationId: stationId,
        parkingBikeTotCnt: parseInt(realtimeInfo.parkingBikeTotCnt) || 0,
        rackTotCnt: parseInt(realtimeInfo.rackTotCnt) || 0,
        updatedAt: new Date(),
      };

      return result;
    } catch (error) {
      this.logger.error(`실시간 동기화 실패: ${stationId}`, error);
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
        `전체 실시간 동기화 완료: ${successCount}개 성공, ${failureCount}개 실패 (총 ${allStations.length}개)`,
      );

      return { successCount, failureCount, details };
    } catch (error) {
      this.logger.error('전체 실시간 동기화 실패:', error);
      throw error;
    }
  }
}
