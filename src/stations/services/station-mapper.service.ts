import { Injectable } from '@nestjs/common';
import {
  StationResponseDto,
  NearbyStationResponseDto,
} from '../dto/station-api.dto';
import type { StationRawQueryResult } from '../interfaces/station.interfaces';
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
      address: raw.address,
      latitude,
      longitude,
      total_racks: raw.total_racks,
      current_bikes: raw.current_bikes,
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

  /**
   * StationResponseDto를 NearbyStationResponseDto로 변환 (실시간 정보, 거리, 주소 포함)
   */
  mapToNearbyResponse(
    station: StationResponseDto & { distance?: number },
  ): NearbyStationResponseDto {
    return {
      name: station.name,
      number: station.number,
      address: station.address,
      latitude: station.latitude,
      longitude: station.longitude,
      current_bikes: station.current_bikes,
      distance: station.distance,
    };
  }

  /**
   * StationResponseDto 배열을 NearbyStationResponseDto 배열로 변환
   */
  mapToNearbyResponseArray(
    stations: (StationResponseDto & { distance?: number })[],
  ): NearbyStationResponseDto[] {
    return stations.map((station) => this.mapToNearbyResponse(station));
  }
}
