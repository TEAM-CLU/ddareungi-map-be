import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  GraphHopperPath,
  GraphHopperResponse,
} from '../interfaces/graphhopper.interface';

/**
 * GraphHopperService
 * - GraphHopper API 연동 및 경로 데이터 반환
 * - 프로필/라운드트립/대안 경로 등 다양한 요청 지원
 */
@Injectable()
export class GraphHopperService {
  private static readonly BASE_URL = 'http://localhost:8989';
  private static readonly PROFILES = ['safe_bike', 'fast_bike'] as const;
  private static readonly ROUTE_DETAILS = ['road_class', 'bike_network'];
  private static readonly DEFAULT_ALT_PATHS = 3;
  private static readonly DEFAULT_ROUNDTRIP_POINTS = 2;
  private readonly logger = new Logger(GraphHopperService.name);

  constructor(private readonly httpService: HttpService) {}

  /**
   * 단일 프로필로 GraphHopper 경로 요청
   */
  async getSingleRoute(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    profile: string,
  ): Promise<GraphHopperPath> {
    const requestBody = {
      points: [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ],
      profile,
      elevation: true,
      points_encoded: false,
      details: GraphHopperService.ROUTE_DETAILS,
    };
    try {
      const response = await firstValueFrom(
        this.httpService.post<GraphHopperResponse>(
          `${GraphHopperService.BASE_URL}/route`,
          requestBody,
        ),
      );
      if (!response.data.paths?.length) {
        this.logger.warn(
          `GraphHopper API 응답에 경로가 없음 - Profile: ${profile}`,
        );
        throw new Error('No route found');
      }
      return response.data.paths[0];
    } catch (error: unknown) {
      this.logger.error(
        `GraphHopper API 호출 실패 - Profile: ${profile}, From: [${from.lat}, ${from.lng}], To: [${to.lat}, ${to.lng}]`,
      );
      this.logger.debug(`에러 상세:`, error);
      throw error;
    }
  }

  /**
   * 두 프로필(safe_bike, fast_bike)로 3개씩 경로 검색
   */
  async getMultipleRoutes(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): Promise<GraphHopperPath[]> {
    const allPaths: GraphHopperPath[] = [];
    for (const profile of GraphHopperService.PROFILES) {
      const requestBody = {
        points: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
        profile,
        elevation: true,
        points_encoded: false,
        details: GraphHopperService.ROUTE_DETAILS,
        'alternative_route.max_paths': GraphHopperService.DEFAULT_ALT_PATHS,
      };
      try {
        const response = await firstValueFrom(
          this.httpService.post<GraphHopperResponse>(
            `${GraphHopperService.BASE_URL}/route`,
            requestBody,
          ),
        );
        for (const path of response.data.paths) {
          path.profile = profile;
          allPaths.push(path);
        }
      } catch (error: unknown) {
        this.logger.error(
          `GraphHopper 프로필별 경로 검색 실패 - Profile: ${profile}`,
        );
        this.logger.debug(`에러 상세:`, error);
      }
    }
    return allPaths;
  }

  /**
   * 대안 경로 포함 - 단일 프로필로 여러 경로 요청
   */
  async getAlternativeRoutes(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    profile: string,
    maxPaths: number = GraphHopperService.DEFAULT_ALT_PATHS,
  ): Promise<GraphHopperPath[]> {
    const requestBody = {
      points: [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ],
      profile,
      elevation: true,
      points_encoded: false,
      details: GraphHopperService.ROUTE_DETAILS,
      'alternative_route.max_paths': maxPaths,
      'ch.disable': true,
    };
    try {
      const response = await firstValueFrom(
        this.httpService.post<GraphHopperResponse>(
          `${GraphHopperService.BASE_URL}/route`,
          requestBody,
        ),
      );
      if (!response.data.paths?.length) {
        this.logger.warn(
          `GraphHopper 대안 경로 검색 결과 없음 - Profile: ${profile}`,
        );
        throw new Error('No route found');
      }
      return response.data.paths.map((path) => ({ ...path, profile }));
    } catch (error: unknown) {
      this.logger.error(
        `GraphHopper 대안 경로 검색 실패 - Profile: ${profile}, From: [${from.lat}, ${from.lng}], To: [${to.lat}, ${to.lng}]`,
      );
      this.logger.debug(`에러 상세:`, error);
      throw new Error(
        `Failed to get routes: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * 원형 경로(Round Trip) - 두 프로필로 요청
   */
  async getRoundTripRoutes(
    start: { lat: number; lng: number },
    targetDistance: number,
  ): Promise<GraphHopperPath[]> {
    const allPaths: GraphHopperPath[] = [];
    for (const profile of GraphHopperService.PROFILES) {
      const seed = Math.floor(Math.random() * 1000);
      const requestBody = {
        points: [[start.lng, start.lat]],
        profile,
        elevation: true,
        points_encoded: false,
        details: GraphHopperService.ROUTE_DETAILS,
        algorithm: 'round_trip',
        'ch.disable': true,
        'round_trip.distance': targetDistance,
        'round_trip.seed': seed,
        'round_trip.points': GraphHopperService.DEFAULT_ROUNDTRIP_POINTS,
      };
      try {
        const response = await firstValueFrom(
          this.httpService.post<GraphHopperResponse>(
            `${GraphHopperService.BASE_URL}/route`,
            requestBody,
          ),
        );
        for (const path of response.data.paths) {
          path.profile = profile;
          allPaths.push(path);
        }
      } catch (error: unknown) {
        this.logger.error(
          `GraphHopper 원형 경로 검색 실패 - Profile: ${profile}, Distance: ${targetDistance}m`,
        );
        this.logger.debug(`에러 상세:`, error);
      }
    }
    this.logger.debug(
      `GraphHopper 원형 경로 검색 완료 - 총 경로 수: ${allPaths.length}`,
    );
    return allPaths;
  }

  /**
   * 원형 경로(Round Trip) - 단일 프로필
   */
  async getSingleRoundTripRoute(
    start: { lat: number; lng: number },
    profile: string,
    targetDistance: number,
  ): Promise<GraphHopperPath> {
    const seed = Math.floor(Math.random() * 1000);
    const requestBody = {
      points: [[start.lng, start.lat]],
      profile,
      elevation: true,
      points_encoded: false,
      details: GraphHopperService.ROUTE_DETAILS,
      algorithm: 'round_trip',
      'ch.disable': true,
      'round_trip.distance': targetDistance,
      'round_trip.seed': seed,
      'round_trip.points': GraphHopperService.DEFAULT_ROUNDTRIP_POINTS,
    };
    try {
      const response = await firstValueFrom(
        this.httpService.post<GraphHopperResponse>(
          `${GraphHopperService.BASE_URL}/route`,
          requestBody,
        ),
      );
      if (!response.data.paths?.length) {
        this.logger.warn(
          `GraphHopper 단일 원형 경로 검색 결과 없음 - Profile: ${profile}`,
        );
        throw new Error('No round trip route found');
      }
      return response.data.paths[0];
    } catch (error: unknown) {
      this.logger.error(
        `GraphHopper 단일 원형 경로 검색 실패 - Profile: ${profile}, Distance: ${targetDistance}m`,
      );
      this.logger.debug(`에러 상세:`, error);
      throw error;
    }
  }
}
