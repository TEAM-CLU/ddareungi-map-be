import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  GraphHopperPath,
  GraphHopperResponse,
} from '../interfaces/graphhopper.interface';

@Injectable()
export class GraphHopperService {
  private readonly logger = new Logger(GraphHopperService.name);
  private readonly graphHopperBaseUrl = 'http://localhost:8989';

  constructor(private readonly httpService: HttpService) {}

  /**
   * GraphHopper API 호출 (단일 프로필)
   */
  async getSingleRoute(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    profile: string,
  ): Promise<GraphHopperPath> {
    const requestBody = {
      points: [
        [from.lng, from.lat], // GraphHopper는 [lng, lat] 순서
        [to.lng, to.lat],
      ],
      profile: profile,
      elevation: true,
      points_encoded: false,
      details: ['road_class', 'bike_network'],
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<GraphHopperResponse>(
          `${this.graphHopperBaseUrl}/route`,
          requestBody,
        ),
      );

      if (!response.data.paths || response.data.paths.length === 0) {
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
   * GraphHopper API 호출 - 2개 프로필로 3개씩 경로를 검색하여 최적 경로 3개 반환
   */
  async getMultipleRoutes(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): Promise<GraphHopperPath[]> {
    const profiles = ['safe_bike', 'fast_bike'];
    const allPaths: GraphHopperPath[] = [];

    // 각 프로필별로 3개씩 경로 검색
    for (const profile of profiles) {
      const requestBody = {
        points: [
          [from.lng, from.lat], // GraphHopper는 [lng, lat] 순서
          [to.lng, to.lat],
        ],
        profile: profile,
        elevation: true,
        points_encoded: false,
        details: ['road_class', 'bike_network'],
        'alternative_route.max_paths': 3,
      };

      try {
        const response = await firstValueFrom(
          this.httpService.post<GraphHopperResponse>(
            `${this.graphHopperBaseUrl}/route`,
            requestBody,
          ),
        );

        // 각 경로에 프로필 정보 추가
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
   * GraphHopper API 호출 (대안 경로 포함)
   */
  async getAlternativeRoutes(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    profile: string,
    maxPaths: number = 3,
  ): Promise<GraphHopperPath[]> {
    const requestBody = {
      points: [
        [from.lng, from.lat], // GraphHopper는 [lng, lat] 순서
        [to.lng, to.lat],
      ],
      profile: profile,
      elevation: true,
      points_encoded: false,
      details: ['road_class', 'bike_network'],
      'alternative_route.max_paths': maxPaths,
      'ch.disable': true,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<GraphHopperResponse>(
          `${this.graphHopperBaseUrl}/route`,
          requestBody,
        ),
      );

      if (!response.data.paths || response.data.paths.length === 0) {
        this.logger.warn(
          `GraphHopper 대안 경로 검색 결과 없음 - Profile: ${profile}`,
        );
        throw new Error('No route found');
      }

      // 각 경로에 프로필 정보 추가
      return response.data.paths.map((path) => ({
        ...path,
        profile: profile,
      }));
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
   * Round Trip용 GraphHopper API 호출
   */
  async getRoundTripRoutes(
    start: { lat: number; lng: number },
    targetDistance: number,
  ): Promise<GraphHopperPath[]> {
    const profiles = ['safe_bike', 'fast_bike'];
    const allPaths: GraphHopperPath[] = [];

    for (const profile of profiles) {
      const seed = Math.floor(Math.random() * 1000);
      const requestBody = {
        points: [[start.lng, start.lat]],
        profile: profile,
        elevation: true,
        points_encoded: false,
        details: ['road_class', 'bike_network'],
        algorithm: 'round_trip',
        'ch.disable': true,
        'round_trip.distance': targetDistance,
        'round_trip.seed': seed,
        'round_trip.points': 2,
        'alternative_route.max_paths': 3,
      };

      try {
        const response = await firstValueFrom(
          this.httpService.post<GraphHopperResponse>(
            `${this.graphHopperBaseUrl}/route`,
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
   * Round Trip용 단일 경로 호출
   */
  async getSingleRoundTripRoute(
    start: { lat: number; lng: number },
    profile: string,
    targetDistance: number,
  ): Promise<GraphHopperPath> {
    const seed = Math.floor(Math.random() * 1000);
    const requestBody = {
      points: [[start.lng, start.lat]],
      profile: profile,
      elevation: true,
      points_encoded: false,
      details: ['road_class', 'bike_network'],
      algorithm: 'round_trip',
      'ch.disable': true,
      'round_trip.distance': targetDistance,
      'round_trip.seed': seed,
      'round_trip.points': 2,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<GraphHopperResponse>(
          `${this.graphHopperBaseUrl}/route`,
          requestBody,
        ),
      );

      if (!response.data.paths || response.data.paths.length === 0) {
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
