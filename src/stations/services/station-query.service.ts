import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Station } from '../entities/station.entity';
import {
  StationResponseDto,
  StationRawQueryResult,
  mapRawQueryToStationResponse,
} from '../dto/station.dto';
import {
  GeoJSONFeatureCollection,
  GeoJSONFeature,
} from '../interfaces/station.interfaces';
import { StationRealtimeService } from './station-realtime.service';

// 상수 정의
const QUERY_CONSTANTS = {
  NEARBY_STATIONS_LIMIT: 3,
} as const;

@Injectable()
export class StationQueryService {
  constructor(
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    private readonly stationRealtimeService: StationRealtimeService,
  ) {}

  /**
   * 공통 select 절을 가진 쿼리 빌더 생성
   */
  private createBaseStationQuery() {
    return this.stationRepository
      .createQueryBuilder('station')
      .select([
        'station.station_id as id',
        'station.station_name as name',
        'station.station_number as number',
        'station.total_racks as total_racks',
        'station.current_adult_bikes as current_adult_bikes',
        'station.status as status',
        'station.last_updated_at as last_updated_at',
        'ST_X(station.location::geometry) as longitude',
        'ST_Y(station.location::geometry) as latitude',
      ]);
  }

  /**
   * 위치 기반 가장 가까운 대여소 3개 검색 - 실시간 정보 포함
   */
  async findNearbyStations(
    latitude: number,
    longitude: number,
  ): Promise<StationResponseDto[]> {
    const query = this.createBaseStationQuery()
      .addSelect(
        'ST_Distance(station.location, ST_MakePoint(:longitude, :latitude)::geography) as distance',
      )
      .setParameters({ longitude, latitude })
      .orderBy('distance', 'ASC')
      .limit(QUERY_CONSTANTS.NEARBY_STATIONS_LIMIT);

    const rawResults = await query.getRawMany();
    const stationResults = rawResults.map((row: StationRawQueryResult) =>
      mapRawQueryToStationResponse(row),
    );

    // 실시간 대여정보 동기화
    await this.stationRealtimeService.syncRealtimeInfoForStations(
      stationResults,
    );

    return stationResults;
  }

  /**
   * 모든 대여소 조회
   */
  async findAll(): Promise<StationResponseDto[]> {
    const stations = await this.createBaseStationQuery().getRawMany();

    return stations.map((row: StationRawQueryResult) =>
      mapRawQueryToStationResponse(row),
    );
  }

  /**
   * 대여소 ID로 조회
   */
  async findOne(stationId: string): Promise<StationResponseDto | null> {
    const result = (await this.createBaseStationQuery()
      .where('station.station_id = :stationId', { stationId })
      .getRawOne()) as StationRawQueryResult | null;

    if (!result) {
      return null;
    }

    return mapRawQueryToStationResponse(result);
  }

  /**
   * 지도 영역 내 모든 대여소 조회 - 실시간 정보 포함
   */
  async findStationsInMapArea(
    latitude: number,
    longitude: number,
    radius: number,
  ): Promise<StationResponseDto[]> {
    const query = this.createBaseStationQuery()
      .addSelect(
        'ST_Distance(station.location, ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)) as distance',
      )
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
    const stationResults = rawResults.map((row: StationRawQueryResult) =>
      mapRawQueryToStationResponse(row),
    );

    // 실시간 대여정보 동기화
    await this.stationRealtimeService.syncRealtimeInfoForStations(
      stationResults,
    );

    return stationResults;
  }

  /**
   * StationResponseDto 배열을 GeoJSON FeatureCollection으로 변환
   */
  convertStationsToGeoJSON(
    stations: StationResponseDto[],
  ): GeoJSONFeatureCollection {
    return {
      type: 'FeatureCollection',
      features: stations.map((station): GeoJSONFeature => {
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [station.longitude, station.latitude], // GeoJSON은 [경도, 위도] 순서
          },
          properties: {
            id: station.id,
            name: station.name,
            number: station.number || undefined,
            total_racks: station.total_racks,
            current_adult_bikes: station.current_adult_bikes,
            status: station.status,
            last_updated_at: station.last_updated_at || undefined,
          },
        };
      }),
    };
  }
}
