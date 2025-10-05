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

    this.logger.debug(
      `GraphHopper API POST 호출 - Profile: ${profile}`,
      requestBody,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.post<GraphHopperResponse>(
          `${this.graphHopperBaseUrl}/route`,
          requestBody,
        ),
      );

      if (!response.data.paths || response.data.paths.length === 0) {
        throw new Error('No route found');
      }

      return response.data.paths[0];
    } catch (error) {
      this.logger.error(`Failed to get route for ${profile}:`, error);
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
    }

    return allPaths;
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
      const requestBody = {
        points: [[start.lng, start.lat]],
        profile: profile,
        elevation: true,
        points_encoded: false,
        details: ['road_class', 'bike_network'],
        algorithm: 'round_trip',
        'ch.disable': true,
        'round_trip.distance': targetDistance,
        'round_trip.seed': Math.floor(Math.random() * 1000),
        'round_trip.points': 2,
        'alternative_route.max_paths': 3,
      };

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
    }

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
    const requestBody = {
      points: [[start.lng, start.lat]],
      profile: profile,
      elevation: true,
      points_encoded: false,
      details: ['road_class', 'bike_network'],
      algorithm: 'round_trip',
      'ch.disable': true,
      'round_trip.distance': targetDistance,
      'round_trip.seed': Math.floor(Math.random() * 1000),
      'round_trip.points': 2,
    };

    const response = await firstValueFrom(
      this.httpService.post<GraphHopperResponse>(
        `${this.graphHopperBaseUrl}/route`,
        requestBody,
      ),
    );

    return response.data.paths[0];
  }
}
