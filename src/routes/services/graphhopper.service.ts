import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  GraphHopperPath,
  GraphHopperResponse,
} from '../interfaces/graphhopper.interface';

/**
 * 상수 정의
 */
const BASE_URL = 'http://localhost:8989';
const PROFILES = ['safe_bike', 'fast_bike'] as const;
const ROUTE_DETAILS = ['road_class', 'bike_network'] as const;
const DEFAULT_ALT_PATHS = 3;
const DEFAULT_ROUNDTRIP_POINTS = 2;

/**
 * GraphHopperService
 * GraphHopper API 연동 및 경로 데이터를 제공하는 서비스
 * - 단일 경로, 다중 경로, 대안 경로, 원형 경로 검색 지원
 */
@Injectable()
export class GraphHopperService {
  private readonly logger = new Logger(GraphHopperService.name);

  constructor(private readonly httpService: HttpService) {}

  // ============================================================================
  // Public API - Single Profile Routes
  // ============================================================================

  /**
   * 단일 프로필로 경로 검색
   * @param from 출발지 좌표
   * @param to 도착지 좌표
   * @param profile 경로 프로필 (safe_bike 또는 fast_bike)
   * @returns GraphHopper 경로 데이터
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
      details: ROUTE_DETAILS,
      instruction: true,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<GraphHopperResponse>(
          `${BASE_URL}/route`,
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
   * 단일 프로필로 대안 경로 포함 검색
   * @param from 출발지 좌표
   * @param to 도착지 좌표
   * @param profile 경로 프로필 (safe_bike 또는 fast_bike)
   * @param maxPaths 최대 경로 개수 (기본값: 3)
   * @returns GraphHopper 경로 배열
   */
  async getAlternativeRoutes(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    profile: string,
    maxPaths: number = DEFAULT_ALT_PATHS,
  ): Promise<GraphHopperPath[]> {
    const requestBody = {
      points: [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ],
      profile,
      elevation: true,
      points_encoded: false,
      details: ROUTE_DETAILS,
      'alternative_route.max_paths': maxPaths,
      'ch.disable': true,
      instruction: true,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<GraphHopperResponse>(
          `${BASE_URL}/route`,
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
   * 단일 프로필로 원형 경로 검색
   * @param start 출발지 좌표 (도착지와 동일)
   * @param profile 경로 프로필 (safe_bike 또는 fast_bike)
   * @param targetDistance 목표 거리 (미터)
   * @returns GraphHopper 원형 경로 데이터
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
      details: ROUTE_DETAILS,
      algorithm: 'round_trip',
      'ch.disable': true,
      'round_trip.distance': targetDistance,
      'round_trip.seed': seed,
      'round_trip.points': DEFAULT_ROUNDTRIP_POINTS,
      instruction: true,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<GraphHopperResponse>(
          `${BASE_URL}/route`,
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

  // ============================================================================
  // Public API - Multiple Profile Routes
  // ============================================================================

  /**
   * 두 프로필(safe_bike, fast_bike)로 다중 경로 검색
   * @param from 출발지 좌표
   * @param to 도착지 좌표
   * @returns 모든 프로필의 경로 배열
   */
  async getMultipleRoutes(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): Promise<GraphHopperPath[]> {
    const allPaths: GraphHopperPath[] = [];

    for (const profile of PROFILES) {
      const requestBody = {
        points: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
        profile,
        elevation: true,
        points_encoded: false,
        details: ROUTE_DETAILS,
        'alternative_route.max_paths': DEFAULT_ALT_PATHS,
        instruction: true,
      };

      try {
        const response = await firstValueFrom(
          this.httpService.post<GraphHopperResponse>(
            `${BASE_URL}/route`,
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
   * 두 프로필(safe_bike, fast_bike)로 원형 경로 검색
   * @param start 출발지 좌표 (도착지와 동일)
   * @param targetDistance 목표 거리 (미터)
   * @returns 모든 프로필의 원형 경로 배열
   */
  async getRoundTripRoutes(
    start: { lat: number; lng: number },
    targetDistance: number,
  ): Promise<GraphHopperPath[]> {
    const allPaths: GraphHopperPath[] = [];

    for (const profile of PROFILES) {
      const seed = Math.floor(Math.random() * 1000);
      const requestBody = {
        points: [[start.lng, start.lat]],
        profile,
        elevation: true,
        points_encoded: false,
        details: ROUTE_DETAILS,
        algorithm: 'round_trip',
        'ch.disable': true,
        'round_trip.distance': targetDistance,
        'round_trip.seed': seed,
        'round_trip.points': DEFAULT_ROUNDTRIP_POINTS,
        instruction: true,
      };

      try {
        const response = await firstValueFrom(
          this.httpService.post<GraphHopperResponse>(
            `${BASE_URL}/route`,
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
}
