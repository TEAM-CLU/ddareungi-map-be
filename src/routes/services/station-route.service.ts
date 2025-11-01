import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { StationQueryService } from '../../stations/services/station-query.service';
import { StationResponseDto } from '../../stations/dto/station-api.dto';
import { RouteUtilService } from './route-util.service';
import { RouteStationDto } from '../dto/route.dto';

/**
 * StationRouteService
 * 경로 생성을 위한 대여소 검색 및 변환을 담당하는 서비스
 */
@Injectable()
export class StationRouteService {
  private readonly logger = new Logger(StationRouteService.name);

  constructor(
    private readonly stationQueryService: StationQueryService,
    @Inject(forwardRef(() => RouteUtilService))
    private readonly routeUtil: RouteUtilService,
  ) {}

  // ============================================================================
  // Public API - Station Search
  // ============================================================================

  /**
   * 좌표 근처의 가용한 대여소 찾기 (3단계 폴백 전략)
   * 1차: 실시간 동기화 포함 검색
   * 2차: DB 직접 조회
   * 3차: 에러 시 DB 직접 조회 재시도
   * @param coordinate 검색 좌표
   * @returns 가용한 대여소 또는 null
   */
  async findNearestAvailableStation(coordinate: {
    lat: number;
    lng: number;
  }): Promise<RouteStationDto | null> {
    try {
      // 1차: 실시간 동기화 포함 검색
      const nearbyStations = await this.stationQueryService.findNearbyStations(
        coordinate.lat,
        coordinate.lng,
      );

      if (nearbyStations.length > 0) {
        return this.convertToRouteStation(nearbyStations[0]);
      }

      // 2차: DB 직접 조회 (폴백)
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

      // 3차: 에러 발생 시 DB 직접 조회 재시도
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
   * 출발지와 도착지 대여소를 병렬로 검색
   * @param startCoordinate 출발지 좌표
   * @param endCoordinate 도착지 좌표
   * @returns 시작 및 도착 대여소
   * @throws 대여소를 찾을 수 없는 경우 에러 발생
   */
  async findStartAndEndStations(
    startCoordinate: { lat: number; lng: number },
    endCoordinate: { lat: number; lng: number },
  ): Promise<{ startStation: RouteStationDto; endStation: RouteStationDto }> {
    const [startStation, endStation] = await Promise.all([
      this.findNearestAvailableStation(startCoordinate),
      this.findNearestAvailableStation(endCoordinate),
    ]);

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
   * @param coordinate 검색 좌표
   * @param purpose 용도 (에러 메시지용)
   * @returns 가용한 대여소
   * @throws 대여소를 찾을 수 없는 경우 에러 발생
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

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * DB에서 직접 available 대여소 조회 (실시간 동기화 제외)
   * @param latitude 위도
   * @param longitude 경도
   * @returns 가용한 대여소 배열 (상위 10개)
   */
  private async findNearbyAvailableStationsFromDB(
    latitude: number,
    longitude: number,
  ): Promise<StationResponseDto[]> {
    try {
      const allNearbyStations = await this.stationQueryService.findAll();

      // 거리 계산 및 정렬
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
        .slice(0, 10);

      return stationsWithDistance;
    } catch (error) {
      this.logger.error('DB에서 대여소 조회 실패', error);
      return [];
    }
  }

  /**
   * StationResponseDto를 RouteStationDto로 변환
   * @param station 대여소 응답 DTO
   * @returns 경로용 대여소 DTO
   */
  private convertToRouteStation(station: StationResponseDto): RouteStationDto {
    return {
      number: station.number ?? '',
      name: station.name,
      lat: station.latitude,
      lng: station.longitude,
      current_bikes: station.current_bikes,
    };
  }
}
