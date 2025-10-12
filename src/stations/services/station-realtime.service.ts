import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { Station } from '../entities/station.entity';
import { SeoulApiService } from './seoul-api.service';
import { StationResponseDto } from '../dto/station-api.dto';
import { SeoulBikeRealtimeInfo } from '../dto/station.dto';
import { StationDomainService } from './station-domain.service';

@Injectable()
export class StationRealtimeService {
  private readonly logger = new Logger(StationRealtimeService.name);

  constructor(
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    private readonly seoulApiService: SeoulApiService,
    private readonly stationDomainService: StationDomainService,
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
        if (!realtimeInfo) {
          // 실시간 정보가 없는 경우 inactive로 설정
          station.status = 'inactive';
          station.last_updated_at = new Date();
          continue;
        }

        // 응답 객체에 실시간 정보 반영 (상태 계산 로직 개선)
        const currentBikes = parseInt(realtimeInfo.parkingBikeTotCnt) || 0;
        const totalRacks = parseInt(realtimeInfo.rackTotCnt) || 0;
        const calculatedStatus =
          this.stationDomainService.calculateStationStatus(
            currentBikes,
            totalRacks,
            true,
          );

        station.current_bikes = currentBikes;
        station.total_racks = totalRacks;
        station.status = calculatedStatus;
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
   * StationDomainService 상태 계산 로직 사용
   */
  private createRealtimeUpdateData(
    realtimeInfo: SeoulBikeRealtimeInfo,
  ): Partial<Station> {
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

      // 실시간 정보를 받지 못한 대여소들을 inactive로 설정
      const failedStationIds = stationIds.filter(
        (id) => !realtimeInfoMap.has(id),
      );

      // 성공한 대여소들 업데이트
      for (const [stationId, realtimeInfo] of realtimeInfoMap.entries()) {
        try {
          const updateData = this.createRealtimeUpdateData(realtimeInfo);
          await this.stationRepository.update({ id: stationId }, updateData);
        } catch {
          this.logger.warn(`대여소 ${stationId} DB 업데이트 실패`);
        }
      }

      // 실패한 대여소들을 inactive로 설정
      for (const stationId of failedStationIds) {
        try {
          await this.stationRepository.update(
            { id: stationId },
            {
              status: 'inactive',
              last_updated_at: new Date(),
            },
          );
          this.logger.warn(
            `대여소 ${stationId} 실시간 정보 없음 - inactive로 설정`,
          );
        } catch {
          this.logger.warn(`대여소 ${stationId} inactive 상태 업데이트 실패`);
        }
      }

      return realtimeInfoMap;
    } catch (error) {
      this.logger.error('ID 기반 실시간 동기화 실패:', error);

      // 전체 실패한 경우 모든 대여소를 inactive로 설정
      for (const stationId of stationIds) {
        try {
          await this.stationRepository.update(
            { id: stationId },
            {
              status: 'inactive',
              last_updated_at: new Date(),
            },
          );
        } catch {
          this.logger.warn(`대여소 ${stationId} inactive 상태 업데이트 실패`);
        }
      }

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
        this.logger.warn(`실시간 정보 없음: ${stationId} - inactive로 설정`);

        // 실시간 정보가 없는 경우 inactive로 설정
        const updateResult = await this.stationRepository.update(
          { id: stationId },
          {
            status: 'inactive',
            last_updated_at: new Date(),
          },
        );

        if (updateResult.affected === 0) {
          this.logger.warn(`대여소 없음: ${stationId}`);
        }

        return null;
      }

      // 데이터베이스 업데이트
      const updateData = this.createRealtimeUpdateData(realtimeInfo);
      const updateResult = await this.stationRepository.update(
        { id: stationId },
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

      // 동기화 실패 시에도 inactive로 설정
      try {
        await this.stationRepository.update(
          { id: stationId },
          {
            status: 'inactive',
            last_updated_at: new Date(),
          },
        );
        this.logger.warn(`대여소 ${stationId} 동기화 실패 - inactive로 설정`);
      } catch {
        this.logger.warn(`대여소 ${stationId} inactive 상태 업데이트 실패`);
      }

      throw error;
    }
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
      const realtimeInfoMap = await this.syncRealtimeInfoByIds(stationIds);

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

        const realtimeInfo = realtimeInfoMap.get(station.id);
        if (realtimeInfo) {
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
