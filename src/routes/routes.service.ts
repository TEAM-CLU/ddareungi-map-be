import { Injectable, Logger } from '@nestjs/common';
import {
  FullJourneyRequestDto,
  RouteDto,
  RoundTripSearchRequestDto,
  CircularRouteRequestDto,
  CoordinateDto,
  RouteSegmentDto,
  BoundingBoxDto,
} from './dto/route.dto';
import { RouteOptimizerService } from './services/route-optimizer.service';
import { RouteConverterService } from './services/route-converter.service';
import { GraphHopperService } from './services/graphhopper.service';
import { StationRouteService } from './services/station-route.service';
import { GraphHopperPath } from './interfaces/graphhopper.interface';

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    private readonly routeOptimizer: RouteOptimizerService,
    private readonly routeConverter: RouteConverterService,
    private readonly graphHopperService: GraphHopperService,
    private readonly stationRouteService: StationRouteService,
  ) {}

  /**
   * 통합 경로 검색 (A → B, 경유지 포함 가능)
   * safe_bike, fast_bike 프로필로 각각 검색하여 최적 3개 경로 반환
   */
  async findFullJourney(request: FullJourneyRequestDto): Promise<RouteDto[]> {
    try {
      // 경유지가 있으면 다구간 경로 처리
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

      // 각 자전거 경로에 대해 완전한 RouteDto 생성
      return optimalBikePaths.map((bikePath) =>
        this.routeConverter.buildRouteFromGraphHopper(
          walkingToStart,
          bikePath,
          walkingFromEnd,
          startStation,
          endStation,
          bikePath.routeCategory,
        ),
      );
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

      for (const category of categories) {
        const route = await this.buildMultiLegRoute(
          bikeRoutePoints,
          category,
          walkingToStart,
          walkingFromEnd,
        );
        routes.push(route);
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

  /**
   * 다구간 경로 구축 (도보 구간 포함)
   */
  private async buildMultiLegRoute(
    points: CoordinateDto[],
    category: { name: string; priority: string },
    walkingToStart?: GraphHopperPath,
    walkingFromEnd?: GraphHopperPath,
  ): Promise<RouteDto> {
    const segments: RouteSegmentDto[] = [];
    let totalDistance = 0;
    let totalTime = 0;
    let totalAscent = 0;
    let totalDescent = 0;

    // 첫 번째 도보 구간 추가 (출발지 → 시작 대여소)
    if (walkingToStart) {
      const walkingSegment =
        this.routeConverter.convertToRouteSegment(walkingToStart);
      // 도보 세그먼트로 타입 변경
      walkingSegment.type = 'walking';
      segments.push(walkingSegment);

      totalDistance += walkingToStart.distance;
      totalTime += walkingToStart.time;
      totalAscent += walkingToStart.ascend || 0;
      totalDescent += walkingToStart.descend || 0;
    }

    // 각 자전거 구간별로 경로 검색
    for (let i = 0; i < points.length - 1; i++) {
      const segmentStart = points[i];
      const segmentEnd = points[i + 1];

      // safe_bike과 fast_bike으로 대안 경로 검색
      const [safeRoutes, fastRoutes] = await Promise.all([
        this.graphHopperService.getAlternativeRoutes(
          segmentStart,
          segmentEnd,
          'safe_bike',
          3,
        ),
        this.graphHopperService.getAlternativeRoutes(
          segmentStart,
          segmentEnd,
          'fast_bike',
          3,
        ),
      ]);

      // 카테고리에 따라 최적 경로 선택
      const selectedRoute = this.selectRouteByCategory(
        [...safeRoutes, ...fastRoutes],
        category.priority,
      );

      // 자전거 구간 세그먼트로 변환
      const segment = this.routeConverter.convertToRouteSegment(selectedRoute);
      segments.push(segment);

      // 총합 계산
      totalDistance += selectedRoute.distance;
      totalTime += selectedRoute.time;
      totalAscent += selectedRoute.ascend || 0;
      totalDescent += selectedRoute.descend || 0;
    }

    // 마지막 도보 구간 추가 (도착 대여소 → 도착지)
    if (walkingFromEnd) {
      const walkingSegment =
        this.routeConverter.convertToRouteSegment(walkingFromEnd);
      // 도보 세그먼트로 타입 변경
      walkingSegment.type = 'walking';
      segments.push(walkingSegment);

      totalDistance += walkingFromEnd.distance;
      totalTime += walkingFromEnd.time;
      totalAscent += walkingFromEnd.ascend || 0;
      totalDescent += walkingFromEnd.descend || 0;
    }

    // 전체 경계 상자 계산
    const bbox = this.calculateBoundingBox(segments);

    return {
      routeCategory: category.name,
      summary: {
        distance: totalDistance,
        time: totalTime,
        ascent: totalAscent,
        descent: totalDescent,
      },
      bbox,
      segments,
    };
  }

  /**
   * 카테고리에 따른 최적 경로 선택
   */
  private selectRouteByCategory(
    routes: GraphHopperPath[],
    priority: string,
  ): GraphHopperPath {
    switch (priority) {
      case 'bike_priority': {
        // safe_bike 프로필 중 가장 안전한 경로
        const safeRoutes = routes.filter((r) => r.profile === 'safe_bike');
        return safeRoutes.sort((a, b) => a.time - b.time)[0] || routes[0];
      }

      case 'time':
        // 최소 시간 경로
        return routes.sort((a, b) => a.time - b.time)[0];

      case 'distance':
        // 최단 거리 경로
        return routes.sort((a, b) => a.distance - b.distance)[0];

      default:
        return routes[0];
    }
  }

  /**
   * 세그먼트들의 경계 상자 계산
   */
  private calculateBoundingBox(segments: RouteSegmentDto[]): BoundingBoxDto {
    const allBboxes = segments.map((s) => s.bbox);

    return {
      minLat: Math.min(...allBboxes.map((b) => b.minLat)),
      minLng: Math.min(...allBboxes.map((b) => b.minLng)),
      maxLat: Math.max(...allBboxes.map((b) => b.maxLat)),
      maxLng: Math.max(...allBboxes.map((b) => b.maxLng)),
    };
  }

  /**
   * 왕복 경로 검색 (A → B → A)
   * safe_bike, fast_bike 프로필로 각각 검색하여 최적 3개 경로 반환
   */
  async findRoundTripSearch(
    request: RoundTripSearchRequestDto,
  ): Promise<RouteDto[]> {
    try {
      // 경유지가 있으면 다구간 왕복 경로 처리
      if (request.waypoints && request.waypoints.length > 0) {
        return this.findMultiLegRoundTrip(request);
      }

      // 기존 A-B-A 직접 왕복 경로 처리 (반환점이 없는 경우는 에러)
      throw new Error(
        '왕복 경로 검색에는 최소한 하나의 반환점(return_point)이 필요합니다.',
      );
    } catch (error) {
      this.logger.error('Round trip search failed', error);
      throw error;
    }
  }

  /**
   * 직접 왕복 경로 검색 (A → B → A, 경유지 없음)
   */
  private async findDirectRoundTrip(
    start: CoordinateDto,
    returnPoint: CoordinateDto,
  ): Promise<RouteDto[]> {
    this.logger.debug('직접 왕복 경로 검색 시작');

    try {
      // 실제 대여소 검색 (에러 처리는 StationRouteService에서 담당)
      const startStation =
        await this.stationRouteService.findNearestAvailableStation(start);

      if (!startStation) {
        throw new Error(
          `시작지 근처에 이용 가능한 대여소를 찾을 수 없습니다. 좌표: ${start.lat}, ${start.lng}`,
        );
      }

      // 도보 구간들
      const [walkingToStation, walkingFromStation] = await Promise.all([
        this.graphHopperService.getSingleRoute(start, startStation, 'foot'),
        this.graphHopperService.getSingleRoute(startStation, start, 'foot'),
      ]);

      // 자전거 왕복 경로 최적 검색 (시작→반환점, 반환점→시작)
      const [optimalOutboundPaths, optimalReturnPaths] = await Promise.all([
        this.routeOptimizer.findOptimalRoutes(
          startStation,
          returnPoint, // 시작 대여소 → 반환점
        ),
        this.routeOptimizer.findOptimalRoutes(
          returnPoint,
          startStation, // 반환점 → 시작 대여소
        ),
      ]);

      // 같은 카테고리끼리 매칭하여 왕복 RouteDto 생성
      const roundTripRoutes = this.routeConverter.buildRoundTripRoutesFromPaths(
        optimalOutboundPaths,
        optimalReturnPaths,
        walkingToStation,
        walkingFromStation,
        startStation,
      );

      this.logger.debug(
        `직접 왕복 경로 검색 완료 - 시작 대여소: ${startStation.name}, GraphHopper API 호출: 도보 2회, 자전거 왕복 경로 ${roundTripRoutes.length}개 생성`,
      );

      return roundTripRoutes;
    } catch (error) {
      this.logger.error(
        '직접 왕복 경로 검색 중 GraphHopper API 호출 실패',
        error,
      );
      throw error;
    }
  }

  /**
   * 다구간 왕복 경로 검색 (A → 경유지들 → B → 경유지들 → A)
   */
  private async findMultiLegRoundTrip(
    request: RoundTripSearchRequestDto,
  ): Promise<RouteDto[]> {
    const { start, waypoints } = request;

    if (!waypoints || waypoints.length === 0) {
      throw new Error('왕복 경로에는 최소한 하나의 포인트가 필요합니다.');
    }

    // 반환점 찾기 (return_point 타입)
    const returnPoints = waypoints.filter((wp) => wp.type === 'return_point');
    if (returnPoints.length === 0) {
      throw new Error('왕복 경로에는 반드시 하나의 반환점이 필요합니다.');
    }
    if (returnPoints.length > 1) {
      throw new Error('왕복 경로에는 반환점이 하나만 허용됩니다.');
    }

    const returnPoint = returnPoints[0].location;
    const returnPointIndex = waypoints.findIndex(
      (wp) => wp.type === 'return_point',
    );

    // 반환점 이전과 이후의 경유지들 분리
    const waypointsBeforeReturn = waypoints
      .slice(0, returnPointIndex)
      .filter((wp) => wp.type === 'waypoint')
      .map((wp) => wp.location);

    const waypointsAfterReturn = waypoints
      .slice(returnPointIndex + 1)
      .filter((wp) => wp.type === 'waypoint')
      .map((wp) => wp.location);

    this.logger.debug(
      `다구간 왕복 경로 검색 시작 - 반환점 이전 경유지: ${waypointsBeforeReturn.length}개, 반환점 이후 경유지: ${waypointsAfterReturn.length}개`,
    );

    try {
      // 실제 대여소 검색 (에러 처리는 StationRouteService에서 담당)
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

      // 전진 경로: 시작 대여소 → 반환점 이전 경유지들 → 반환점
      const forwardPoints: CoordinateDto[] = [
        startStation,
        ...waypointsBeforeReturn,
        returnPoint,
      ];

      // 복귀 경로: 반환점 → 반환점 이후 경유지들 → 시작 대여소
      const returnRoutePoints: CoordinateDto[] = [
        returnPoint,
        ...waypointsAfterReturn,
        startStation,
      ];

      this.logger.debug(
        `왕복 경로 - 전진: ${forwardPoints.length}개 포인트 (반환점 이전 경유지: ${waypointsBeforeReturn.length}개), 복귀: ${returnRoutePoints.length}개 포인트 (반환점 이후 경유지: ${waypointsAfterReturn.length}개)`,
      );

      // 각 카테고리별 최적 왕복 경로 생성
      const categories = [
        { name: '자전거 도로 우선', priority: 'bike_priority' },
        { name: '최소 시간', priority: 'time' },
        { name: '최단 거리', priority: 'distance' },
      ];

      const routes: RouteDto[] = [];

      for (const category of categories) {
        const forwardRoute = await this.buildMultiLegRoute(
          forwardPoints,
          category,
          walkingToStation, // 출발 시 도보
        );
        const returnRoute = await this.buildMultiLegRoute(
          returnRoutePoints,
          category,
          undefined, // 복귀 시 시작 도보 없음
          walkingFromStation, // 복귀 시 마지막 도보
        );

        // 왕복 경로 통합
        const roundTripRoute = this.mergeRoundTripRoutes(
          forwardRoute,
          returnRoute,
        );
        routes.push(roundTripRoute);
      }

      this.logger.debug(
        `다구간 왕복 경로 검색 완료 - GraphHopper API 호출: 도보 2회, 자전거 구간 다수회, 총 ${routes.length}개 경로 생성`,
      );

      return routes;
    } catch (error) {
      this.logger.error(
        '다구간 왕복 경로 검색 중 GraphHopper API 호출 실패',
        error,
      );
      throw error;
    }
  }

  /**
   * 왕복 경로 통합
   */
  private mergeRoundTripRoutes(
    forwardRoute: RouteDto,
    returnRoute: RouteDto,
  ): RouteDto {
    return {
      routeCategory: forwardRoute.routeCategory,
      summary: {
        distance: forwardRoute.summary.distance + returnRoute.summary.distance,
        time: forwardRoute.summary.time + returnRoute.summary.time,
        ascent: forwardRoute.summary.ascent + returnRoute.summary.ascent,
        descent: forwardRoute.summary.descent + returnRoute.summary.descent,
      },
      bbox: this.mergeBoundingBoxes(forwardRoute.bbox, returnRoute.bbox),
      segments: [...forwardRoute.segments, ...returnRoute.segments],
    };
  }

  /**
   * 경계 상자 통합
   */
  private mergeBoundingBoxes(
    bbox1: BoundingBoxDto,
    bbox2: BoundingBoxDto,
  ): BoundingBoxDto {
    return {
      minLat: Math.min(bbox1.minLat, bbox2.minLat),
      minLng: Math.min(bbox1.minLng, bbox2.minLng),
      maxLat: Math.max(bbox1.maxLat, bbox2.maxLat),
      maxLng: Math.max(bbox1.maxLng, bbox2.maxLng),
    };
  }

  /**
   * 원형 경로 추천
   * safe_bike, fast_bike 프로필로 각각 검색하여 최적 3개 경로 반환
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

      // 각 원형 경로에 대해 RouteDto 생성
      return optimalCircularPaths.map((circularPath) =>
        this.routeConverter.buildCircularRoute(
          walkingToStation,
          circularPath,
          walkingFromStation,
          station,
        ),
      );
    } catch (error) {
      this.logger.error('원형 경로 추천 중 GraphHopper API 호출 실패', error);
      throw error;
    }
  }
}
