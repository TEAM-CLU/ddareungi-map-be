import { Injectable } from '@nestjs/common';
import { StationResponseDto } from '../dto/station.dto';
import { StationRawQueryResult } from '../interfaces/station.interfaces';
import { StationDomainService } from './station-domain.service';

/**
 * 데이터 변환 전담 서비스
 */
@Injectable()
export class StationMapperService {
  constructor(private readonly stationDomainService: StationDomainService) {}

  /**
   * Raw Query 결과를 StationResponseDto로 변환 (핵심 매핑 함수)
   */
  mapRawQueryToResponse(raw: StationRawQueryResult): StationResponseDto {
    // 좌표 파싱 및 검증
    const latitude = parseFloat(raw.latitude);
    const longitude = parseFloat(raw.longitude);

    if (!this.stationDomainService.isValidCoordinates(latitude, longitude)) {
      throw new Error(
        `유효하지 않은 좌표 데이터: lat=${raw.latitude}, lng=${raw.longitude}`,
      );
    }

    if (!raw.id || !raw.name) {
      throw new Error('필수 필드(id, name)가 누락되었습니다.');
    }

    return {
      id: raw.id,
      name: raw.name,
      number: raw.number || null,
      latitude,
      longitude,
      total_racks: raw.total_racks,
      current_adult_bikes: raw.current_adult_bikes,
      status: raw.status,
      last_updated_at: raw.last_updated_at,
    };
  }

  /**
   * Raw Query 결과 배열을 ResponseDto 배열로 변환
   */
  mapRawQueryArrayToResponse(
    rawArray: StationRawQueryResult[],
  ): StationResponseDto[] {
    return rawArray.map((raw) => this.mapRawQueryToResponse(raw));
  }
}
