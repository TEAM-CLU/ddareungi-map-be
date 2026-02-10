import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, In } from 'typeorm';
import { Station } from '../entities/station.entity';
import { SeoulApiService } from './seoul-api.service';
import { StationResponseDto } from '../dto/station-api.dto';
import { SeoulBikeRealtimeInfo } from '../dto/station.dto';
import { StationDomainService } from './station-domain.service';
import { StationSyncLockService } from './station-sync-lock.service';

@Injectable()
export class StationRealtimeService {
  private readonly logger = new Logger(StationRealtimeService.name);
  /**
   * 한번에 락을 잡고 처리할 배치 크기
   * - 락을 오래 잡지 않도록 전체 요청을 chunk로 나눠 처리합니다.
   */
  private readonly lockBatchSize = Math.max(
    1,
    Number(process.env.STATION_REALTIME_LOCK_BATCH_SIZE ?? 50),
  );
  /**
   * 락 TTL (초)
   * - Redis 장애 시(락 bypass 모드)에는 적용되지 않습니다.
   * - 기본값은 "측정된 서울시 API P99(로컬 기준 약 118ms) + 호출 간격(60ms) + 배치 크기(50)" 기반으로 산정합니다.
   * - 필요 시 `STATION_REALTIME_LOCK_TTL_SECONDS`로 강제 지정하세요.
   */
  private readonly lockTtlSeconds = (() => {
    const explicit = process.env.STATION_REALTIME_LOCK_TTL_SECONDS;
    if (explicit) return Number(explicit);

    // P99, inter-delay는 환경에 따라 달라지므로 필요 시 env로 교체 가능
    const p99Ms = Number(process.env.SEOUL_REALTIME_API_P99_MS ?? 120);
    const interDelayMs = Number(
      process.env.SEOUL_REALTIME_INTER_REQUEST_DELAY_MS ?? 60,
    );

    // chunk 전체를 처리하는 동안 락이 유지되므로, chunk 기간을 커버하도록 계산
    const ttl =
      Math.ceil(((p99Ms + interDelayMs) * this.lockBatchSize) / 1000) + 2;
    return Math.max(3, ttl);
  })();

  constructor(
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    private readonly seoulApiService: SeoulApiService,
    private readonly stationDomainService: StationDomainService,
    private readonly stationSyncLockService: StationSyncLockService,
  ) {}

  private realtimeLockKey(stationId: string): string {
    return `lock:station:realtime:${stationId}`;
  }

  private toRealtimeInfoFromStation(
    station: Station,
    stationId: string,
  ): SeoulBikeRealtimeInfo {
    return {
      stationId,
      stationName: station.name ?? '',
      rackTotCnt: String(station.total_racks ?? 0),
      parkingBikeTotCnt: String(station.current_bikes ?? 0),
      shared: '',
      stationLatitude: '',
      stationLongitude: '',
    };
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
      const { realtimeInfoMap } = await this.syncRealtimeInfoByIds(stationIds);

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

      this.logger.debug(
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
  public async syncRealtimeInfoByIds(stationIds: string[]): Promise<{
    realtimeInfoMap: Map<string, SeoulBikeRealtimeInfo>;
    /**
     * 락을 획득하고(=API 호출 대상) 실시간 정보를 실제로 받은 개수
     * - 이 개수만큼은 DB 업데이트를 시도합니다.
     * - inactive -> available/empty 복구는 "실시간 정보를 다시 받는 순간" status를 재계산하여 덮어쓰는 방식으로 자연스럽게 이루어집니다.
     */
    successCount: number;
    /**
     * 락 획득 실패로 인해 외부 API를 호출하지 않은 개수
     */
    skippedCount: number;
    /**
     * 락은 획득했지만 실시간 정보를 받지 못했거나(혹은 API 호출 자체가 실패) 실패로 처리된 개수
     */
    failureCount: number;
  }> {
    if (stationIds.length === 0) {
      return {
        realtimeInfoMap: new Map(),
        successCount: 0,
        skippedCount: 0,
        failureCount: 0,
      };
    }

    const realtimeInfoMap = new Map<string, SeoulBikeRealtimeInfo>();
    let successCount = 0;
    let skippedCount = 0;
    let failureCount = 0;

    try {
      // 전체 요청을 chunk로 분할 처리 (락을 오래 잡지 않기 위함)
      for (
        let start = 0;
        start < stationIds.length;
        start += this.lockBatchSize
      ) {
        const batchIds = stationIds.slice(start, start + this.lockBatchSize);
        const lockKeys = batchIds.map((id) => this.realtimeLockKey(id));
        const idByKey = new Map<string, string>();
        for (let i = 0; i < batchIds.length; i++) {
          idByKey.set(lockKeys[i], batchIds[i]);
        }

        const acquire = await this.stationSyncLockService.tryAcquireMany(
          lockKeys,
          this.lockTtlSeconds,
        );

        let bypassLocks = false;
        const lockedBatchIds: string[] = [];
        const skippedBatchIds: string[] = [];
        const tokenByStationId = new Map<string, string>();

        if (acquire.mode === 'bypass') {
          bypassLocks = true;
          lockedBatchIds.push(...batchIds);
        } else {
          // acquired
          for (const [key, token] of acquire.tokensByKey.entries()) {
            const id = idByKey.get(key);
            if (id) {
              lockedBatchIds.push(id);
              tokenByStationId.set(id, token);
            }
          }
          for (const key of acquire.skippedKeys) {
            const id = idByKey.get(key);
            if (id) skippedBatchIds.push(id);
          }
        }

        // 락을 얻은 ID만 실시간 정보 조회 (bypass 시에는 전부 호출)
        const batchRealtimeInfoMap =
          await this.seoulApiService.fetchMultipleRealtimeStationInfo(
            lockedBatchIds,
          );

        // 통계 산출 (요구사항 기준)
        successCount += batchRealtimeInfoMap.size;
        skippedCount += bypassLocks ? 0 : skippedBatchIds.length;
        failureCount += lockedBatchIds.length - batchRealtimeInfoMap.size;

        // 성공한 대여소들 업데이트 (API로 받은 것만)
        for (const [stationId, info] of batchRealtimeInfoMap.entries()) {
          try {
            const updateData = this.createRealtimeUpdateData(info);
            await this.stationRepository.update({ id: stationId }, updateData);
          } catch {
            this.logger.debug(`대여소 ${stationId} DB 업데이트 실패`);
          }
        }

        // 실시간 정보를 받지 못한(=락 획득한) 대여소들을 inactive로 설정
        const failedLockedIds = lockedBatchIds.filter(
          (id) => !batchRealtimeInfoMap.has(id),
        );
        if (failedLockedIds.length > 0) {
          for (const stationId of failedLockedIds) {
            try {
              await this.stationRepository.update(
                { id: stationId },
                { status: 'inactive', last_updated_at: new Date() },
              );
            } catch {
              this.logger.debug(
                `대여소 ${stationId} inactive 상태 업데이트 실패`,
              );
            }
          }
          this.logger.debug(
            `실시간 정보 없음 - ${failedLockedIds.length}개 대여소 inactive로 설정`,
          );
        }

        // 락 획득 실패한 ID는 DB 값을 결과에 채워 넣어(inactive 오인 방지)
        if (!bypassLocks && skippedBatchIds.length > 0) {
          const stations = await this.stationRepository.find({
            where: { id: In(skippedBatchIds) },
            select: ['id', 'name', 'current_bikes', 'total_racks'],
          });
          for (const st of stations) {
            batchRealtimeInfoMap.set(
              st.id,
              this.toRealtimeInfoFromStation(st, st.id),
            );
          }
        }

        // 결과 map에 합치기
        for (const [stationId, info] of batchRealtimeInfoMap.entries()) {
          realtimeInfoMap.set(stationId, info);
        }

        // 락 해제 (bypass 모드면 skip)
        if (!bypassLocks) {
          await Promise.all(
            lockedBatchIds.map((stationId) =>
              this.stationSyncLockService.release(
                this.realtimeLockKey(stationId),
                tokenByStationId.get(stationId) as string,
              ),
            ),
          );
        }
      }

      return { realtimeInfoMap, successCount, skippedCount, failureCount };
    } catch (error) {
      this.logger.error('ID 기반 실시간 동기화 실패:', error);

      // 반환은 DB 기반으로(가능한 경우)
      const fallback = new Map<string, SeoulBikeRealtimeInfo>();
      try {
        const stations = await this.stationRepository.find({
          where: { id: In(stationIds) },
          select: ['id', 'name', 'current_bikes', 'total_racks'],
        });
        for (const st of stations) {
          fallback.set(st.id, this.toRealtimeInfoFromStation(st, st.id));
        }
      } catch {
        // ignore
      }
      return {
        realtimeInfoMap: fallback,
        successCount: 0,
        skippedCount: 0,
        failureCount: stationIds.length,
      };
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
    const lockKey = this.realtimeLockKey(stationId);
    const lock = await this.stationSyncLockService.tryAcquire(
      lockKey,
      this.lockTtlSeconds,
    );

    // 락 획득 실패: 외부 API 호출 없이 DB 값 반환
    if (lock.mode === 'skipped') {
      const station = await this.stationRepository.findOne({
        where: { id: stationId },
        select: ['id', 'current_bikes', 'total_racks', 'last_updated_at'],
      });
      if (!station) return null;

      return {
        stationId,
        parkingBikeTotCnt: station.current_bikes ?? 0,
        rackTotCnt: station.total_racks ?? 0,
        updatedAt: station.last_updated_at ?? new Date(),
      };
    }

    const bypassLocks = lock.mode === 'bypass';

    try {
      // 실시간 정보 조회
      const realtimeInfo =
        await this.seoulApiService.fetchRealtimeStationInfo(stationId);

      if (!realtimeInfo) {
        this.logger.debug(`실시간 정보 없음: ${stationId} - inactive로 설정`);

        // 실시간 정보가 없는 경우 inactive로 설정
        const updateResult = await this.stationRepository.update(
          { id: stationId },
          {
            status: 'inactive',
            last_updated_at: new Date(),
          },
        );

        if (updateResult.affected === 0) {
          this.logger.debug(`대여소 없음: ${stationId}`);
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
        this.logger.debug(`대여소 없음: ${stationId}`);
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
        this.logger.debug(`대여소 ${stationId} 동기화 실패 - inactive로 설정`);
      } catch {
        this.logger.debug(`대여소 ${stationId} inactive 상태 업데이트 실패`);
      }

      throw error;
    } finally {
      if (!bypassLocks && lock.mode === 'locked') {
        await this.stationSyncLockService.release(lockKey, lock.token);
      }
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
      const { realtimeInfoMap } = await this.syncRealtimeInfoByIds(stationIds);

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

      this.logger.debug(
        `전체 실시간 동기화 완료: ${successCount}개 성공, ${failureCount}개 실패 (총 ${allStations.length}개)`,
      );

      return { successCount, failureCount, details };
    } catch (error) {
      this.logger.error('전체 실시간 동기화 실패:', error);
      throw error;
    }
  }
}
