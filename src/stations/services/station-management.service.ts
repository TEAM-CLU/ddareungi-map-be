import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Station } from '../entities/station.entity';
import { StationResponseDto } from '../dto/station.dto';
import { CreateStationDto } from '../dto/station-api.dto';
import { DeleteAllResult } from '../interfaces/station.interfaces';
import { StationDomainService } from './station-domain.service';
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
    private readonly stationDomainService: StationDomainService,
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

    // 자전거 수를 기반으로 상태 계산
    const currentBikes = createStationDto.current_adult_bikes || 0;
    const totalRacks = createStationDto.total_racks || 0;
    const calculatedStatus = this.stationDomainService.calculateStationStatus(
      currentBikes,
      totalRacks,
      true,
    );

    const station = this.stationRepository.create({
      id: createStationDto.id,
      name: createStationDto.name,
      number: createStationDto.number,
      district: createStationDto.district,
      address: createStationDto.address,
      total_racks: createStationDto.total_racks,
      current_adult_bikes: currentBikes,
      status: calculatedStatus,
      location,
      last_updated_at: new Date(),
    });

    const savedStation = await this.stationRepository.save(station);

    return {
      id: savedStation.id,
      name: savedStation.name,
      number: savedStation.number,
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
      id: stationId,
    });

    if (result.affected === 0) {
      throw new NotFoundException(`대여소 ID ${stationId}를 찾을 수 없습니다.`);
    }
  }

  /**
   * 모든 대여소 삭제 (관리자용 - 주의 필요)
   */
  async removeAll(confirmKey: string): Promise<DeleteAllResult> {
    // 안전 확인 키 검증
    if (confirmKey !== MANAGEMENT_CONSTANTS.DELETE_CONFIRM_KEY) {
      throw new ForbiddenException(
        '잘못된 확인 키입니다. 전체 삭제 작업이 취소되었습니다.',
      );
    }

    this.logger.warn('🚨 전체 대여소 삭제 작업 시작');

    try {
      // 현재 대여소 수 확인
      const currentCount = await this.stationRepository.count();
      this.logger.log(`삭제 대상 대여소 수: ${currentCount}개`);

      if (currentCount === 0) {
        this.logger.log('삭제할 대여소가 없습니다.');
        return {
          deleted: 0,
          deletedCount: 0,
          success: true,
          message: '삭제할 대여소가 없습니다.',
        };
      }

      // 모든 대여소 삭제
      await this.stationRepository.clear();

      this.logger.warn(`✅ 전체 대여소 삭제 완료: ${currentCount}개 삭제됨`);

      return {
        deleted: currentCount,
        deletedCount: currentCount,
        success: true,
        message: `모든 대여소가 성공적으로 삭제되었습니다. (${currentCount}개 삭제됨)`,
      };
    } catch (error) {
      this.logger.error('전체 대여소 삭제 실패:', error);
      throw new InternalServerErrorException(
        '전체 대여소 삭제 중 오류가 발생했습니다.',
      );
    }
  }
}
