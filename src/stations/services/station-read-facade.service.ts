import { Injectable, NotFoundException } from '@nestjs/common';
import {
  NearbyStationResponseDto,
  StationResponseDto,
} from '../dto/station-api.dto';
import { GeoJsonResponse } from '../interfaces/station.interfaces';
import { StationMapperService } from './station-mapper.service';
import { StationQueryService } from './station-query.service';
import { StationRealtimeService } from './station-realtime.service';

type StationResponseFormat = 'json' | 'geojson';

type StationReadResult<T> = {
  message: string;
  data: T;
};

@Injectable()
export class StationReadFacadeService {
  constructor(
    private readonly stationQueryService: StationQueryService,
    private readonly stationRealtimeService: StationRealtimeService,
    private readonly stationMapperService: StationMapperService,
  ) {}

  async getNearbyStations(
    latitude: number,
    longitude: number,
    format: StationResponseFormat,
  ): Promise<
    StationReadResult<NearbyStationResponseDto[] | GeoJsonResponse>
  > {
    const stations = await this.stationQueryService.findNearbyStations(
      latitude,
      longitude,
    );

    if (format === 'geojson') {
      return {
        message: `GeoJSON 형태로 가장 가까운 대여소 ${stations.length}개를 성공적으로 조회했습니다.`,
        data: this.stationQueryService.convertStationsToGeoJSON(stations),
      };
    }

    return {
      message: `근처 대여소 ${stations.length}개를 성공적으로 조회했습니다.`,
      data: this.stationMapperService.mapToNearbyResponseArray(stations),
    };
  }

  async getStationsWithinRadius(
    latitude: number,
    longitude: number,
    radius: number,
    format: StationResponseFormat,
  ): Promise<
    StationReadResult<NearbyStationResponseDto[] | GeoJsonResponse>
  > {
    const stations = await this.stationQueryService.findStationsInMapArea(
      latitude,
      longitude,
      radius,
    );

    if (stations.length === 0) {
      return {
        message: `지정된 영역(반경 ${radius}m) 내에 이용 가능한 대여소가 없습니다.`,
        data:
          format === 'geojson'
            ? { type: 'FeatureCollection', features: [] }
            : [],
      };
    }

    if (format === 'geojson') {
      return {
        message: `GeoJSON 형태로 지도 영역 내 대여소 ${stations.length}개를 성공적으로 조회했습니다.`,
        data: this.stationQueryService.convertStationsToGeoJSON(stations),
      };
    }

    return {
      message: `지도 영역 내 대여소 ${stations.length}개를 성공적으로 조회했습니다.`,
      data: this.stationMapperService.mapToNearbyResponseArray(stations),
    };
  }

  async getAllStations(
    format: StationResponseFormat,
  ): Promise<StationReadResult<StationResponseDto[] | GeoJsonResponse>> {
    const stations = await this.stationQueryService.findAll();

    if (format === 'geojson') {
      return {
        message: 'GeoJSON 형태로 모든 대여소를 성공적으로 조회했습니다.',
        data: this.stationQueryService.convertStationsToGeoJSON(stations),
      };
    }

    return {
      message: '모든 대여소를 성공적으로 조회했습니다.',
      data: stations,
    };
  }

  async getStationDetail(params: {
    number: string;
    format: StationResponseFormat;
    latitude?: number;
    longitude?: number;
  }): Promise<StationReadResult<NearbyStationResponseDto | GeoJsonResponse>> {
    const station = await this.findStationByNumberWithOptionalDistance(params);

    if (!station) {
      throw new NotFoundException('대여소를 찾을 수 없습니다.');
    }

    await this.stationRealtimeService.syncSingleStationRealtimeInfo(station.id);

    const updatedStation =
      await this.findStationByNumberWithOptionalDistance(params);

    if (!updatedStation) {
      throw new NotFoundException('대여소 업데이트 후 조회에 실패했습니다.');
    }

    if (params.format === 'geojson') {
      return {
        message: 'GeoJSON 형태로 대여소 상세 정보를 성공적으로 조회했습니다.',
        data: this.stationQueryService.convertStationsToGeoJSON([updatedStation]),
      };
    }

    return {
      message: '대여소를 성공적으로 조회했습니다.',
      data: this.stationMapperService.mapToNearbyResponse(updatedStation),
    };
  }

  async findStationByNumberOrThrow(number: string): Promise<StationResponseDto> {
    const station = await this.stationQueryService.findByNumber(number);

    if (!station) {
      throw new NotFoundException('대여소를 찾을 수 없습니다.');
    }

    return station;
  }

  private findStationByNumberWithOptionalDistance(params: {
    number: string;
    latitude?: number;
    longitude?: number;
  }) {
    if (params.latitude !== undefined && params.longitude !== undefined) {
      return this.stationQueryService.findByNumberWithDistance(
        params.number,
        params.latitude,
        params.longitude,
      );
    }

    return this.stationQueryService.findByNumber(params.number);
  }
}
