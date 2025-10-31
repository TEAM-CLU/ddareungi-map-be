import { Injectable, Logger } from '@nestjs/common';
import {
  FullJourneyRequestDto,
  RouteDto,
  CircularRouteRequestDto,
  CoordinateDto,
} from './dto/route.dto';
import {
  RouteOptimizerService,
  CategorizedPath,
} from './services/route-optimizer.service';
import { RouteConverterService } from './services/route-converter.service';
import { RouteBuilderService } from './services/route-builder.service';
import { GraphHopperService } from './services/graphhopper.service';
import { StationRouteService } from './services/station-route.service';

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    private readonly routeOptimizer: RouteOptimizerService,
    private readonly routeConverter: RouteConverterService,
    private readonly routeBuilder: RouteBuilderService,
    private readonly graphHopperService: GraphHopperService,
    private readonly stationRouteService: StationRouteService,
  ) {}

  // ============================================
  // 컨트롤러 호출 메서드 (Public API)
  // ============================================

  /**
   * 통합 경로 검색 (A → B, 왕복 경로, 경유지 포함 가능)
   */
  async findFullJourney(request: FullJourneyRequestDto): Promise<RouteDto[]> {
    try {
      // 출발지와 도착지가 같은 경우 (왕복 경로)
      const isRoundTrip = this.isSameLocation(request.start, request.end);

      if (isRoundTrip) {
        // 왕복 경로인 경우 경유지가 반드시 필요
        if (!request.waypoints || request.waypoints.length === 0) {
          throw new Error(
            '왕복 경로 검색에는 최소한 하나의 경유지가 필요합니다.',
          );
        }

        // 왕복 경로를 다구간 경로로 처리
        return this.findRoundTripJourney(request);
      }

      // 일반 경로 처리
      if (request.waypoints && request.waypoints.length > 0) {
        return this.findMultiLegJourney(request);
      }

      // 기존 A-B 직접 경로 처리
      return this.findDirectJourney(request);
    } catch (error) {
      this.logger.error('Full journey search failed', error);
      throw error;
    }
  }

  /**
   * 원형 경로 추천 (지정된 거리의 원형 코스)
   */
  async findRoundTripRecommendations(
    request: CircularRouteRequestDto,
  ): Promise<RouteDto[]> {
    this.logger.debug(
      `원형 경로 추천 시작 - 목표 거리: ${request.targetDistance}m`,
    );

    try {
      // 실제 대여소 검색 (에러 처리는 StationRouteService에서 담당)
      const station =
        await this.stationRouteService.findNearestAvailableStation(
          request.start,
        );

      if (!station) {
        throw new Error(
          `원형 경로 시작지 근처에 이용 가능한 대여소를 찾을 수 없습니다. 좌표: ${request.start.lat}, ${request.start.lng}`,
        );
      }

      // 도보 구간들
      const [walkingToStation, walkingFromStation] = await Promise.all([
        this.graphHopperService.getSingleRoute(request.start, station, 'foot'),
        this.graphHopperService.getSingleRoute(station, request.start, 'foot'),
      ]);

      // 원형 경로 최적 검색 (safe_bike + fast_bike)
      const optimalCircularPaths =
        await this.routeOptimizer.findOptimalCircularRoutes(
          station,
          request.targetDistance,
        );

      this.logger.debug(
        `원형 경로 추천 완료 - 대여소: ${station.name}, GraphHopper API 호출: 도보 2회, 원형 경로 ${optimalCircularPaths.length}개 생성`,
      );

      // 각 원형 경로에 대해 RouteDto 생성 (routeId 순서 일치)
      return optimalCircularPaths.map((circularPath) => {
        const route = this.routeConverter.buildCircularRoute(
          walkingToStation,
          circularPath,
          walkingFromStation,
          station,
          circularPath.routeCategory,
        );
        const {
          routeCategory,
          summary,
          bbox,
          startStation: sStation,
          endStation: eStation,
          segments,
        } = route;
        return {
          routeCategory,
          routeId: circularPath.routeId,
          summary,
          bbox,
          startStation: sStation,
          endStation: eStation,
          segments,
        };
      });
    } catch (error) {
      this.logger.error('원형 경로 추천 중 GraphHopper API 호출 실패', error);
      throw error;
    }
  }

  // ============================================
  // 경로 검색 타입 판별 및 라우팅
  // ============================================

  /**
   * 두 좌표가 같은 위치인지 확인 (왕복 경로 판별)
   */
  private isSameLocation(start: CoordinateDto, end: CoordinateDto): boolean {
    const TOLERANCE = 0.0001; // 약 10미터 정도의 허용 오차
    return (
      Math.abs(start.lat - end.lat) < TOLERANCE &&
      Math.abs(start.lng - end.lng) < TOLERANCE
    );
  }

  /**
   * 왕복 경로 검색 (출발지 = 도착지인 경우)
   */
  private async findRoundTripJourney(
    request: FullJourneyRequestDto,
  ): Promise<RouteDto[]> {
    const { start, waypoints } = request;

    if (!waypoints || waypoints.length === 0) {
      throw new Error('왕복 경로에는 최소한 하나의 경유지가 필요합니다.');
    }

    this.logger.debug(`왕복 경로 검색 시작 - 경유지: ${waypoints.length}개`);

    try {
      // 실제 대여소 검색
      const startStation =
        await this.stationRouteService.findNearestAvailableStation(start);

      if (!startStation) {
        throw new Error(
          `시작지 근처에 이용 가능한 대여소를 찾을 수 없습니다. 좌표: ${start.lat}, ${start.lng}`,
        );
      }

      // 도보 구간들 (출발지⇄시작 대여소)
      const [walkingToStation, walkingFromStation] = await Promise.all([
        this.graphHopperService.getSingleRoute(start, startStation, 'foot'),
        this.graphHopperService.getSingleRoute(startStation, start, 'foot'),
      ]);

      // 왕복 경로: 시작 대여소 → 경유지들 → 시작 대여소
      const roundTripPoints: CoordinateDto[] = [
        startStation,
        ...waypoints,
        startStation,
      ];

      this.logger.debug(
        `왕복 경로 - 총 ${roundTripPoints.length}개 포인트 (경유지: ${waypoints.length}개)`,
      );

      // 각 카테고리별 최적 왕복 경로 생성
      const categories = [
        { name: '자전거 도로 우선', priority: 'bike_priority' },
        { name: '최소 시간', priority: 'time' },
        { name: '최단 거리', priority: 'distance' },
      ];

      const routes: RouteDto[] = [];
      const optimalPaths = await this.routeOptimizer.findOptimalRoutes(
        startStation,
        startStation,
      );
      for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        const route = await this.routeBuilder.buildMultiLegRoute(
          roundTripPoints,
          category,
          walkingToStation, // 출발 시 도보
          walkingFromStation, // 복귀 시 도보
          {
            number: startStation.number,
            name: startStation.name,
            lat: startStation.lat,
            lng: startStation.lng,
            current_bikes: startStation.current_bikes,
          },
        );
        const bikePath = optimalPaths[i];
        const {
          routeCategory,
          summary,
          bbox,
          startStation: sStation,
          endStation: eStation,
          segments,
        } = route;
        routes.push({
          routeCategory,
          routeId: bikePath?.routeId,
          summary,
          bbox,
          startStation: sStation,
          endStation: eStation,
          segments,
        });
      }

      this.logger.debug(
        `왕복 경로 검색 완료 - 대여소: ${startStation.name}, 총 ${routes.length}개 경로 생성`,
      );

      return routes;
    } catch (error) {
      this.logger.error('왕복 경로 검색 중 오류 발생', error);
      throw error;
    }
  }

  // ============================================
  // 구체적인 경로 검색 구현 메서드 (Private)
  // ============================================

  /**
   * 직접 경로 검색 (A → B, 경유지 없음)
   */
  private async findDirectJourney(
    request: FullJourneyRequestDto,
  ): Promise<RouteDto[]> {
    this.logger.debug('직접 경로 검색 시작');
    try {
      // 실제 대여소 검색 (에러 처리는 StationRouteService에서 담당)
      const { startStation, endStation } =
        await this.stationRouteService.findStartAndEndStations(
          request.start,
          request.end,
        );

      // 도보 구간 (출발지 → 시작 대여소, 도착 대여소 → 도착지)
      const [walkingToStart, walkingFromEnd] = await Promise.all([
        this.graphHopperService.getSingleRoute(
          request.start,
          startStation,
          'foot',
        ),
        this.graphHopperService.getSingleRoute(endStation, request.end, 'foot'),
      ]);

      // 자전거 구간 최적 경로 검색 (safe_bike + fast_bike)
      const optimalBikePaths = await this.routeOptimizer.findOptimalRoutes(
        startStation,
        endStation,
      );

      this.logger.debug(
        `직접 경로 검색 완료 - 출발 대여소: ${startStation.name}, 도착 대여소: ${endStation.name}, GraphHopper API 호출: 도보 2회, 자전거 경로 ${optimalBikePaths.length}개 생성`,
      );

      // 각 자전거 경로에 대해 RouteDto 생성 (routeId 포함, instructions 등은 Redis에만 저장)
      return optimalBikePaths.map((bikePath: CategorizedPath) => {
        const route = this.routeConverter.buildRouteFromGraphHopper(
          walkingToStart,
          bikePath,
          walkingFromEnd,
          startStation,
          endStation,
          bikePath.routeCategory,
        );
        const {
          routeCategory,
          summary,
          bbox,
          startStation: sStation,
          endStation: eStation,
          segments,
        } = route;
        return {
          routeCategory,
          routeId: bikePath.routeId,
          summary,
          bbox,
          startStation: sStation,
          endStation: eStation,
          segments,
        };
      });
    } catch (error) {
      this.logger.error('직접 경로 검색 중 GraphHopper API 호출 실패', error);
      throw error;
    }
  }

  /**
   * 다구간 경로 검색 (A → 경유지들 → B)
   */
  private async findMultiLegJourney(
    request: FullJourneyRequestDto,
  ): Promise<RouteDto[]> {
    const { start, end, waypoints } = request;

    this.logger.debug(
      `다구간 경로 검색 시작 - 경유지: ${waypoints?.length || 0}개`,
    );

    try {
      // 실제 대여소 검색 (에러 처리는 StationRouteService에서 담당)
      const { startStation, endStation } =
        await this.stationRouteService.findStartAndEndStations(start, end);

      // 도보 구간들 (출발지→시작 대여소, 도착 대여소→도착지)
      const [walkingToStart, walkingFromEnd] = await Promise.all([
        this.graphHopperService.getSingleRoute(start, startStation, 'foot'),
        this.graphHopperService.getSingleRoute(endStation, end, 'foot'),
      ]);

      // 자전거 경로 포인트 생성: 시작 대여소 → 경유지들 → 도착 대여소
      const bikeRoutePoints = [startStation, ...(waypoints || []), endStation];

      // 각 카테고리별 최적 경로 생성
      const categories = [
        { name: '자전거 도로 우선', priority: 'bike_priority' },
        { name: '최소 시간', priority: 'time' },
        { name: '최단 거리', priority: 'distance' },
      ];

      const routes: RouteDto[] = [];
      let totalApiCalls = 0;
      const optimalPaths = await this.routeOptimizer.findOptimalRoutes(
        startStation,
        endStation,
      );
      for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        const route = await this.routeBuilder.buildMultiLegRoute(
          bikeRoutePoints,
          category,
          walkingToStart,
          walkingFromEnd,
          {
            number: startStation.number,
            name: startStation.name,
            lat: startStation.lat,
            lng: startStation.lng,
            current_bikes: startStation.current_bikes,
          },
          {
            number: endStation.number,
            name: endStation.name,
            lat: endStation.lat,
            lng: endStation.lng,
            current_bikes: endStation.current_bikes,
          },
        );
        const bikePath = optimalPaths[i];
        const {
          routeCategory,
          summary,
          bbox,
          startStation: sStation,
          endStation: eStation,
          segments,
        } = route;
        routes.push({
          routeCategory,
          routeId: bikePath?.routeId,
          summary,
          bbox,
          startStation: sStation,
          endStation: eStation,
          segments,
        });
        totalApiCalls += bikeRoutePoints.length - 1; // 구간 수만큼 API 호출
      }

      this.logger.debug(
        `다구간 경로 검색 완료 - 출발 대여소: ${startStation.name}, 도착 대여소: ${endStation.name}, GraphHopper API 호출: 도보 2회, 자전거 구간 ${totalApiCalls}회, 총 ${routes.length}개 경로 생성`,
      );

      return routes;
    } catch (error) {
      this.logger.error('다구간 경로 검색 중 GraphHopper API 호출 실패', error);
      throw error;
    }
  }
}
