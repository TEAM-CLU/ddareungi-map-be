import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Station } from '../entities/station.entity';
import { CreateStationDto, StationResponseDto } from '../dto/station.dto';
import { DeleteAllResult } from '../interfaces/station.interfaces';
import type { Point } from 'geojson';

// 상수 정의
const MANAGEMENT_CONSTANTS = {
  DELETE_CONFIRM_KEY: 'DELETE_ALL_STATIONS_CONFIRM',
} as const;

@Injectable()
export class StationManagementService {
  private readonly logger = new Logger(StationManagementService.name);

  constructor(
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
  ) {}

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
      station_id: createStationDto.id,
      station_name: createStationDto.name,
      station_number: createStationDto.number,
      district: createStationDto.district,
      address: createStationDto.address,
      total_racks: createStationDto.total_racks,
      current_adult_bikes: createStationDto.current_adult_bikes || 0,
      status: 'empty',
      location,
      last_updated_at: new Date(),
    });

    const savedStation = await this.stationRepository.save(station);

    return {
      id: savedStation.station_id,
      name: savedStation.station_name,
      number: savedStation.station_number,
      latitude: savedStation.location.coordinates[1],
      longitude: savedStation.location.coordinates[0],
      total_racks: savedStation.total_racks,
      current_adult_bikes: savedStation.current_adult_bikes,
      status: savedStation.status,
      last_updated_at: savedStation.last_updated_at,
    };
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
    if (confirmKey !== MANAGEMENT_CONSTANTS.DELETE_CONFIRM_KEY) {
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
}
