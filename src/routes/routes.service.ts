import { Injectable, Logger } from '@nestjs/common';
import { FullJourneyRequestDto, RouteDto } from './dto/full-journey.dto';
import {
  RoundTripSearchRequestDto,
  RoundTripRecommendRequestDto,
} from './dto/round-trip.dto';
import { RouteOptimizerService } from './services/route-optimizer.service';
import { RouteConverterService } from './services/route-converter.service';
import { GraphHopperService } from './services/graphhopper.service';

interface MockStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    private readonly routeOptimizer: RouteOptimizerService,
    private readonly routeConverter: RouteConverterService,
    private readonly graphHopperService: GraphHopperService,
  ) {}

  /**
   * 통합 경로 검색 (A → B)
   * safe_bike, fast_bike 프로필로 각각 검색하여 최적 3개 경로 반환
   */
  async findFullJourney(request: FullJourneyRequestDto): Promise<RouteDto[]> {
    try {
      // 출발지 근처 대여소 (모킹)
      const mockStartStation = {
        id: '1',
        name: '가상 출발 대여소',
        lat: request.start.lat + 0.001,
        lng: request.start.lng + 0.001,
      };

      const mockEndStation = {
        id: '2',
        name: '가상 도착 대여소',
        lat: request.end.lat + 0.001,
        lng: request.end.lng + 0.001,
      };

      // 도보 구간 (출발지 → 시작 대여소, 도착 대여소 → 도착지)
      const [walkingToStart, walkingFromEnd] = await Promise.all([
        this.graphHopperService.getSingleRoute(
          request.start,
          mockStartStation,
          'foot',
        ),
        this.graphHopperService.getSingleRoute(
          mockEndStation,
          request.end,
          'foot',
        ),
      ]);

      // 자전거 구간 최적 경로 검색 (safe_bike + fast_bike)
      const optimalBikePaths = await this.routeOptimizer.findOptimalRoutes(
        mockStartStation,
        mockEndStation,
      );

      // 각 자전거 경로에 대해 완전한 RouteDto 생성
      return optimalBikePaths.map((bikePath) =>
        this.routeConverter.buildRouteFromGraphHopper(
          walkingToStart,
          bikePath,
          walkingFromEnd,
          mockStartStation,
          mockEndStation,
          bikePath.routeCategory,
        ),
      );
    } catch (error) {
      this.logger.error('Full journey search failed', error);
      throw error;
    }
  }

  /**
   * 왕복 경로 검색 (A → B → A)
   * safe_bike, fast_bike 프로필로 각각 검색하여 최적 3개 경로 반환
   */
  async findRoundTripSearch(
    request: RoundTripSearchRequestDto,
  ): Promise<RouteDto[]> {
    try {
      // 시작지 근처 대여소 (모킹)
      const mockStartStation = {
        id: '1',
        name: '시작 대여소',
        lat: request.start.lat + 0.001,
        lng: request.start.lng + 0.001,
      };

      // 도보 구간들
      const [walkingToStation, walkingFromStation] = await Promise.all([
        this.graphHopperService.getSingleRoute(
          request.start,
          mockStartStation,
          'foot',
        ),
        this.graphHopperService.getSingleRoute(
          mockStartStation,
          request.start,
          'foot',
        ),
      ]);

      // 자전거 왕복 경로 최적 검색 (safe_bike + fast_bike)
      const optimalBikePaths = await this.routeOptimizer.findOptimalRoutes(
        mockStartStation,
        request.end, // 반환점
      );

      // 각 자전거 경로에 대해 왕복 RouteDto 생성
      return optimalBikePaths.map((bikePath) =>
        this.routeConverter.buildRoundTripRoute(
          walkingToStation,
          bikePath, // 대여소 → 반환점
          bikePath, // 반환점 → 대여소 (같은 경로 역방향)
          walkingFromStation,
          mockStartStation,
          bikePath.routeCategory,
        ),
      );
    } catch (error) {
      this.logger.error('Round trip search failed', error);
      throw error;
    }
  }

  /**
   * 원형 경로 추천
   * safe_bike, fast_bike 프로필로 각각 검색하여 최적 3개 경로 반환
   */
  async findRoundTripRecommendations(
    request: RoundTripRecommendRequestDto,
  ): Promise<RouteDto[]> {
    try {
      // 출발지 근처 대여소 (모킹)
      const mockStation = {
        id: '1',
        name: '원형 경로 대여소',
        lat: request.start.lat + 0.001,
        lng: request.start.lng + 0.001,
      };

      // 도보 구간들
      const [walkingToStation, walkingFromStation] = await Promise.all([
        this.graphHopperService.getSingleRoute(
          request.start,
          mockStation,
          'foot',
        ),
        this.graphHopperService.getSingleRoute(
          mockStation,
          request.start,
          'foot',
        ),
      ]);

      // 원형 경로 최적 검색 (safe_bike + fast_bike)
      const optimalCircularPaths =
        await this.routeOptimizer.findOptimalCircularRoutes(
          mockStation,
          request.targetDistance,
        );

      // 각 원형 경로에 대해 RouteDto 생성
      return optimalCircularPaths.map((circularPath) =>
        this.routeConverter.buildCircularRoute(
          walkingToStation,
          circularPath,
          walkingFromStation,
          mockStation,
          circularPath.routeCategory,
        ),
      );
    } catch (error) {
      this.logger.error('Round trip recommendations failed', error);
      throw error;
    }
  }
}
