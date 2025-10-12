import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Station } from '../entities/station.entity';
import { StationResponseDto } from '../dto/station-api.dto';
import {
  GeoJsonResponse,
  GeoJsonFeature,
  StationRawQueryResult,
} from '../interfaces/station.interfaces';
import { StationRealtimeService } from './station-realtime.service';
import { StationMapperService } from './station-mapper.service';

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
    private readonly stationMapperService: StationMapperService,
  ) {}

  /**
   * 공통 select 절을 가진 쿼리 빌더 생성
   */
  private createBaseStationQuery() {
    return this.stationRepository
      .createQueryBuilder('station')
      .select([
        'station.id as id',
        'station.name as name',
        'station.number as number',
        'station.district as district',
        'station.address as address',
        'station.total_racks as total_racks',
        'station.current_bikes as current_bikes',
        'station.status as status',
        'station.last_updated_at as last_updated_at',
        'ST_Y(station.location::geometry) as latitude',
        'ST_X(station.location::geometry) as longitude',
      ]);
  }

  /**
   * 위치 기반 가장 가까운 대여소 3개 검색 - 실시간 정보 포함
   */
  async findNearbyStations(
    latitude: number,
    longitude: number,
  ): Promise<StationResponseDto[]> {
    const activeStations: StationResponseDto[] = [];
    let searchLimit: number = QUERY_CONSTANTS.NEARBY_STATIONS_LIMIT;
    const maxSearchLimit = 50; // 최대 검색 제한
    const maxAttempts = 5; // 최대 시도 횟수
    let attempts = 0;

    while (
      activeStations.length < QUERY_CONSTANTS.NEARBY_STATIONS_LIMIT &&
      searchLimit <= maxSearchLimit &&
      attempts < maxAttempts
    ) {
      const query = this.createBaseStationQuery()
        .addSelect(
          'ST_Distance(station.location, ST_MakePoint(:longitude, :latitude)::geography) as distance',
        )
        .where('station.status != :inactiveStatus', {
          inactiveStatus: 'inactive',
        })
        .setParameters({ longitude, latitude })
        .orderBy('distance', 'ASC')
        .limit(searchLimit);

      const rawResults = await query.getRawMany();
      const stationResults = rawResults.map((row: StationRawQueryResult) =>
        this.stationMapperService.mapRawQueryToResponse(row),
      );

      // 실시간 대여정보 동기화
      await this.stationRealtimeService.syncRealtimeInfoForStations(
        stationResults,
      );

      // 실시간 업데이트 후 active 상태인 대여소만 필터링
      const currentActiveStations = stationResults.filter(
        (station) => station.status !== 'inactive',
      );

      // 이미 선택된 대여소 제외하고 새로운 active 대여소만 추가
      const newActiveStations = currentActiveStations.filter(
        (station) =>
          !activeStations.some((existing) => existing.id === station.id),
      );

      activeStations.push(...newActiveStations);

      // 원하는 개수만큼 찾았으면 종료
      if (activeStations.length >= QUERY_CONSTANTS.NEARBY_STATIONS_LIMIT) {
        break;
      }

      // 더 많은 대여소를 검색하기 위해 limit 증가
      searchLimit = Math.min(searchLimit * 2, maxSearchLimit);
      attempts++;
    }

    // 정확히 3개만 반환
    return activeStations.slice(0, QUERY_CONSTANTS.NEARBY_STATIONS_LIMIT);
  }

  /**
   * 모든 대여소 조회
   */
  async findAll(): Promise<StationResponseDto[]> {
    const rawResults = await this.createBaseStationQuery().getRawMany();

    return rawResults.map((row: StationRawQueryResult) =>
      this.stationMapperService.mapRawQueryToResponse(row),
    );
  } /**
   * 대여소 ID로 조회
   */
  async findOne(stationId: string): Promise<StationResponseDto | null> {
    const result = (await this.createBaseStationQuery()
      .where('station.id = :stationId', { stationId })
      .getRawOne()) as StationRawQueryResult | null;

    if (!result) {
      return null;
    }

    return this.stationMapperService.mapRawQueryToResponse(result);
  }

  /**
   * 대여소 번호로 조회
   */
  async findByNumber(number: string): Promise<StationResponseDto | null> {
    const result = (await this.createBaseStationQuery()
      .where('station.number = :number', { number })
      .getRawOne()) as StationRawQueryResult | null;

    if (!result) {
      return null;
    }

    return this.stationMapperService.mapRawQueryToResponse(result);
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
        'ST_Distance(station.location, ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography) as distance',
      )
      .where(
        'ST_DWithin(station.location, ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography, :radius)',
      )
      .andWhere('station.status != :inactiveStatus', {
        inactiveStatus: 'inactive',
      })
      .orderBy('distance', 'ASC')
      .setParameters({
        latitude,
        longitude,
        radius,
      });

    const rawResults = await query.getRawMany();
    const stationResults = rawResults.map((row: StationRawQueryResult) =>
      this.stationMapperService.mapRawQueryToResponse(row),
    );

    // 실시간 대여정보 동기화
    await this.stationRealtimeService.syncRealtimeInfoForStations(
      stationResults,
    );

    // 실시간 업데이트 후 inactive 상태인 대여소 제거
    const activeStations = stationResults.filter(
      (station) => station.status !== 'inactive',
    );

    return activeStations;
  }

  /**
   * StationResponseDto 배열을 GeoJSON FeatureCollection으로 변환
   */
  convertStationsToGeoJSON(stations: StationResponseDto[]): GeoJsonResponse {
    return {
      type: 'FeatureCollection',
      features: stations.map((station): GeoJsonFeature => {
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [station.longitude, station.latitude], // GeoJSON은 [경도, 위도] 순서
          },
          properties: {
            id: station.id,
            name: station.name,
            total_racks: station.total_racks,
            current_bikes: station.current_bikes,
            status: station.status,
            last_updated_at: station.last_updated_at?.toISOString() || null,
          },
        };
      }),
    };
  }
}
