import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { StationQueryService } from '../../stations/services/station-query.service';
import { StationResponseDto } from '../../stations/dto/station-api.dto';
import { RouteUtilService } from './route-util.service';
import { RouteStationDto } from '../dto/route.dto';

@Injectable()
export class StationRouteService {
  private readonly logger = new Logger(StationRouteService.name);
  constructor(
    private readonly stationQueryService: StationQueryService,
    @Inject(forwardRef(() => RouteUtilService))
    private readonly routeUtil: RouteUtilService,
  ) {}

  /**
   * 좌표 근처의 가용한 대여소 찾기 (실시간 동기화 우선, 실패 시 DB 조회)
   * 출발지와 도착지 모두 동일한 로직 사용
   */
  async findNearestAvailableStation(coordinate: {
    lat: number;
    lng: number;
  }): Promise<RouteStationDto | null> {
    try {
      // 1차: 실시간 동기화 포함 검색 (기존 방식)
      const nearbyStations = await this.stationQueryService.findNearbyStations(
        coordinate.lat,
        coordinate.lng,
      );

      if (nearbyStations.length > 0) {
        // 첫 번째 available 대여소 반환
        return this.convertToRouteStation(nearbyStations[0]);
      }

      // 2차: 실시간 동기화 없이 DB에서 직접 조회 (폴백)
      this.logger.warn(
        `실시간 동기화로 대여소를 찾을 수 없어 DB 직접 조회를 시도합니다. 좌표: ${coordinate.lat}, ${coordinate.lng}`,
      );

      const fallbackStations = await this.findNearbyAvailableStationsFromDB(
        coordinate.lat,
        coordinate.lng,
      );

      if (fallbackStations.length === 0) {
        this.logger.warn(
          `좌표 근처에 이용 가능한 대여소를 찾을 수 없습니다. 좌표: ${coordinate.lat}, ${coordinate.lng}`,
        );
        return null;
      }

      return this.convertToRouteStation(fallbackStations[0]);
    } catch (error) {
      this.logger.error('근처 대여소 검색 실패', error);

      // 3차: 에러 발생 시 DB 직접 조회 시도
      try {
        this.logger.warn(
          `에러 발생으로 DB 직접 조회를 시도합니다. 좌표: ${coordinate.lat}, ${coordinate.lng}`,
        );

        const fallbackStations = await this.findNearbyAvailableStationsFromDB(
          coordinate.lat,
          coordinate.lng,
        );

        if (fallbackStations.length > 0) {
          return this.convertToRouteStation(fallbackStations[0]);
        }
      } catch (fallbackError) {
        this.logger.error('DB 직접 조회도 실패', fallbackError);
      }

      return null;
    }
  }

  /**
   * 출발지와 도착지 대여소를 한 번에 검색
   */
  async findStartAndEndStations(
    startCoordinate: { lat: number; lng: number },
    endCoordinate: { lat: number; lng: number },
  ): Promise<{ startStation: RouteStationDto; endStation: RouteStationDto }> {
    // 병렬로 대여소 검색
    const [startStation, endStation] = await Promise.all([
      this.findNearestAvailableStation(startCoordinate),
      this.findNearestAvailableStation(endCoordinate),
    ]);

    // 대여소를 찾을 수 없는 경우 에러 발생
    if (!startStation) {
      throw new Error(
        `출발지 근처에 이용 가능한 대여소를 찾을 수 없습니다. 좌표: ${startCoordinate.lat}, ${startCoordinate.lng}`,
      );
    }

    if (!endStation) {
      throw new Error(
        `도착지 근처에 이용 가능한 대여소를 찾을 수 없습니다. 좌표: ${endCoordinate.lat}, ${endCoordinate.lng}`,
      );
    }

    return { startStation, endStation };
  }

  /**
   * 단일 대여소 검색 (왕복/원형 경로용)
   */
  async findSingleStation(
    coordinate: { lat: number; lng: number },
    purpose: string = '경로',
  ): Promise<RouteStationDto> {
    const station = await this.findNearestAvailableStation(coordinate);

    if (!station) {
      throw new Error(
        `${purpose} 근처에 이용 가능한 대여소를 찾을 수 없습니다. 좌표: ${coordinate.lat}, ${coordinate.lng}`,
      );
    }

    return station;
  }

  /**
   * DB에서 직접 available 대여소 조회 (실시간 동기화 없음)
   * StationQueryService의 findNearbyStations와 동일하지만 실시간 동기화 제외
   */
  private async findNearbyAvailableStationsFromDB(
    latitude: number,
    longitude: number,
  ): Promise<StationResponseDto[]> {
    // StationQueryService.findNearbyStations 로직을 단순화하여 사용
    // 실시간 동기화 없이 DB에서 바로 available 상태인 대여소만 조회
    try {
      const allNearbyStations = await this.stationQueryService.findAll();

      // 거리 계산하여 정렬
      const stationsWithDistance = allNearbyStations
        .filter(
          (station) =>
            station.status === 'available' && station.current_bikes > 0,
        )
        .map((station) => ({
          ...station,
          distance: this.routeUtil.calculateDistance(
            [longitude, latitude],
            [station.longitude, station.latitude],
          ),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 10); // 상위 10개만

      return stationsWithDistance;
    } catch (error) {
      this.logger.error('DB에서 대여소 조회 실패', error);
      return [];
    }
  }
  /**
   * StationResponseDto를 RouteStation으로 변환
   */
  private convertToRouteStation(station: StationResponseDto): RouteStationDto {
    return {
      number: station.number ?? '', // number가 null/undefined면 빈 문자열
      name: station.name,
      lat: station.latitude,
      lng: station.longitude,
      current_bikes: station.current_bikes,
    };
  }
}
