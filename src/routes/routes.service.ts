import { Injectable, Logger } from '@nestjs/common';
import {
  FullJourneyRequestDto,
  RouteDto,
  CircularRouteRequestDto,
  CoordinateDto,
  translateRouteCategories,
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

  // ===== 컨트롤러 호출 메서드 (Public API) =====

  /** 통합 경로 검색 (A → B, 왕복, 경유지 포함) */
  async findFullJourney(request: FullJourneyRequestDto): Promise<RouteDto[]> {
    try {
      this.validateCoordinates(request.start, '출발지');
      this.validateCoordinates(request.end, '도착지');

      const isRoundTrip = this.isSameLocation(request.start, request.end);

      if (isRoundTrip) {
        if (!request.waypoints || request.waypoints.length === 0) {
          throw new Error(
            '왕복 경로 검색에는 최소한 하나의 경유지가 필요합니다.',
          );
        }
        const routes = await this.findRoundTripJourney(request);
        const withoutInstructions =
          RouteConverterService.removeInstructionsFromRoutes(routes);
        return translateRouteCategories(withoutInstructions);
      }

      if (request.waypoints && request.waypoints.length > 0) {
        request.waypoints.forEach((wp, idx) =>
          this.validateCoordinates(wp, `경유지 ${idx + 1}`),
        );
        const routes = await this.findMultiLegJourney(request);
        const withoutInstructions =
          RouteConverterService.removeInstructionsFromRoutes(routes);
        return translateRouteCategories(withoutInstructions);
      }

      const routes = await this.findDirectJourney(request);
      const withoutInstructions =
        RouteConverterService.removeInstructionsFromRoutes(routes);
      return translateRouteCategories(withoutInstructions);
    } catch (error) {
      this.logger.error(
        '통합 경로 검색 실패',
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /** 원형 경로 추천 (지정 거리 원형 코스) */
  async findRoundTripRecommendations(
    request: CircularRouteRequestDto,
  ): Promise<RouteDto[]> {
    try {
      this.validateCoordinates(request.start, '시작 위치');

      if (request.targetDistance <= 0) {
        throw new Error('목표 거리는 0보다 커야 합니다.');
      }

      this.logger.debug(
        `원형 경로 추천 시작 - 목표 거리: ${request.targetDistance}m`,
      );

      const station =
        await this.stationRouteService.findNearestAvailableStation(
          request.start,
        );

      if (!station) {
        throw new Error(
          `원형 경로 시작지 근처에 이용 가능한 대여소를 찾을 수 없습니다.`,
        );
      }

      const [walkingToStation, walkingFromStation] = await Promise.all([
        this.graphHopperService.getSingleRoute(request.start, station, 'foot'),
        this.graphHopperService.getSingleRoute(station, request.start, 'foot'),
      ]);

      const optimalCircularPaths =
        await this.routeOptimizer.findOptimalCircularRoutes(
          station,
          request.targetDistance,
        );

      if (optimalCircularPaths.length === 0) {
        throw new Error('조건에 맞는 원형 경로를 찾을 수 없습니다.');
      }

      this.logger.debug(
        `원형 경로 추천 완료 - 대여소: ${station.name}, 경로 ${optimalCircularPaths.length}개 생성`,
      );

      const routes = optimalCircularPaths.map((circularPath) => {
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

        const routeDto = {
          routeCategory,
          routeId: circularPath.routeId,
          summary,
          bbox,
          startStation: sStation,
          endStation: eStation,
          segments,
        };

        // Redis에 instructions 포함하여 저장
        if (circularPath.routeId) {
          this.routeOptimizer.saveRouteToRedis(circularPath.routeId, routeDto);
        }

        return routeDto;
      });

      // API 응답: instructions 제거 및 카테고리 한글 변환
      const withoutInstructions =
        RouteConverterService.removeInstructionsFromRoutes(routes);
      return translateRouteCategories(withoutInstructions);
    } catch (error) {
      this.logger.error(
        '원형 경로 추천 실패',
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  // ===== 경로 검색 타입 판별 및 라우팅 =====

  /** 좌표 유효성 검증 */
  private validateCoordinates(coord: CoordinateDto, label: string): void {
    if (
      !coord ||
      typeof coord.lat !== 'number' ||
      typeof coord.lng !== 'number'
    ) {
      throw new Error(`${label} 좌표가 올바르지 않습니다.`);
    }
    if (coord.lat < -90 || coord.lat > 90) {
      throw new Error(`${label} 위도는 -90 ~ 90 사이여야 합니다.`);
    }
    if (coord.lng < -180 || coord.lng > 180) {
      throw new Error(`${label} 경도는 -180 ~ 180 사이여야 합니다.`);
    }
  }

  /** 두 좌표가 같은 위치인지 확인 (왕복 판별) */
  private isSameLocation(start: CoordinateDto, end: CoordinateDto): boolean {
    const TOLERANCE = 0.0001;
    return (
      Math.abs(start.lat - end.lat) < TOLERANCE &&
      Math.abs(start.lng - end.lng) < TOLERANCE
    );
  }

  /** 왕복 경로 검색 (출발=도착) */
  private async findRoundTripJourney(
    request: FullJourneyRequestDto,
  ): Promise<RouteDto[]> {
    const { start, waypoints } = request;

    if (!waypoints || waypoints.length === 0) {
      throw new Error('왕복 경로에는 최소한 하나의 경유지가 필요합니다.');
    }

    this.logger.debug(`왕복 경로 검색 시작 - 경유지: ${waypoints.length}개`);

    try {
      const startStation =
        await this.stationRouteService.findNearestAvailableStation(start);

      if (!startStation) {
        throw new Error('시작지 근처에 이용 가능한 대여소를 찾을 수 없습니다.');
      }

      const [walkingToStation, walkingFromStation] = await Promise.all([
        this.graphHopperService.getSingleRoute(start, startStation, 'foot'),
        this.graphHopperService.getSingleRoute(startStation, start, 'foot'),
      ]);

      const roundTripPoints: CoordinateDto[] = [
        startStation,
        ...waypoints,
        startStation,
      ];

      const segmentCount = roundTripPoints.length - 1;
      const allSegmentPaths: CategorizedPath[][] = [];

      for (let i = 0; i < segmentCount; i++) {
        const from = roundTripPoints[i];
        const to = roundTripPoints[i + 1];
        const paths = await this.routeOptimizer.findOptimalRoutes(from, to);

        if (paths.length === 0) {
          throw new Error(
            `구간 ${i + 1}의 경로를 찾을 수 없습니다. (${from.lat},${from.lng}) → (${to.lat},${to.lng})`,
          );
        }
        allSegmentPaths.push(paths);
      }

      const categories = [
        { name: 'bike_priority', priority: 'bike_priority' },
        { name: 'fastest', priority: 'time' },
        { name: 'shortest', priority: 'distance' },
      ];
      const routes: RouteDto[] = [];

      for (let catIdx = 0; catIdx < categories.length; catIdx++) {
        const bikePaths: CategorizedPath[] = allSegmentPaths.map(
          (paths) => paths[catIdx],
        );
        const route = await this.routeBuilder.buildMultiLegRoute(
          roundTripPoints,
          categories[catIdx],
          walkingToStation,
          walkingFromStation,
          {
            number: startStation.number,
            name: startStation.name,
            lat: startStation.lat,
            lng: startStation.lng,
            current_bikes: startStation.current_bikes,
          },
        );

        const routeId = bikePaths.map((p) => p?.routeId).join('-');
        const routeDto = {
          routeCategory: route.routeCategory,
          routeId,
          summary: route.summary,
          bbox: route.bbox,
          startStation: route.startStation,
          endStation: route.endStation,
          segments: route.segments,
        };

        this.routeOptimizer.saveRouteToRedis(routeId, routeDto);
        routes.push(routeDto);
      }

      this.logger.debug(
        `왕복 경로 검색 완료 - 대여소: ${startStation.name}, 총 ${routes.length}개 경로 생성`,
      );

      return routes;
    } catch (error) {
      this.logger.error(
        '왕복 경로 검색 실패',
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  // ===== 구체적 경로 검색 구현 (Private) =====

  /** 직접 경로 검색 (A → B, 경유지 없음) */
  private async findDirectJourney(
    request: FullJourneyRequestDto,
  ): Promise<RouteDto[]> {
    this.logger.debug('직접 경로 검색 시작');

    try {
      const { startStation, endStation } =
        await this.stationRouteService.findStartAndEndStations(
          request.start,
          request.end,
        );

      const [walkingToStart, walkingFromEnd] = await Promise.all([
        this.graphHopperService.getSingleRoute(
          request.start,
          startStation,
          'foot',
        ),
        this.graphHopperService.getSingleRoute(endStation, request.end, 'foot'),
      ]);

      const optimalBikePaths = await this.routeOptimizer.findOptimalRoutes(
        startStation,
        endStation,
      );

      if (optimalBikePaths.length === 0) {
        throw new Error('조건에 맞는 자전거 경로를 찾을 수 없습니다.');
      }

      this.logger.debug(
        `직접 경로 검색 완료 - 출발: ${startStation.name}, 도착: ${endStation.name}, 경로 ${optimalBikePaths.length}개`,
      );

      return optimalBikePaths.map((bikePath: CategorizedPath) => {
        const route = this.routeConverter.buildRouteFromGraphHopper(
          walkingToStart,
          bikePath,
          walkingFromEnd,
          startStation,
          endStation,
          bikePath.routeCategory,
        );

        const routeId =
          bikePath.routeId || this.routeOptimizer.createRouteId(bikePath);

        const routeDto = {
          routeCategory: route.routeCategory,
          routeId,
          summary: route.summary,
          bbox: route.bbox,
          startStation: route.startStation,
          endStation: route.endStation,
          segments: route.segments,
        };

        // Redis에 instructions 포함하여 저장
        this.routeOptimizer.saveRouteToRedis(routeId, routeDto);

        return routeDto;
      });
    } catch (error) {
      this.logger.error(
        '직접 경로 검색 실패',
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /** 다구간 경로 검색 (A → 경유지들 → B) */
  private async findMultiLegJourney(
    request: FullJourneyRequestDto,
  ): Promise<RouteDto[]> {
    const { start, end, waypoints } = request;

    this.logger.debug(
      `다구간 경로 검색 시작 - 경유지: ${waypoints?.length || 0}개`,
    );

    try {
      const { startStation, endStation } =
        await this.stationRouteService.findStartAndEndStations(start, end);

      const [walkingToStart, walkingFromEnd] = await Promise.all([
        this.graphHopperService.getSingleRoute(start, startStation, 'foot'),
        this.graphHopperService.getSingleRoute(endStation, end, 'foot'),
      ]);

      const bikeRoutePoints = [startStation, ...(waypoints || []), endStation];
      const categories = [
        { name: 'bike_priority', priority: 'bike_priority' },
        { name: 'fastest', priority: 'time' },
        { name: 'shortest', priority: 'distance' },
      ];

      const routes: RouteDto[] = [];
      const optimalPaths = await this.routeOptimizer.findOptimalRoutes(
        startStation,
        endStation,
      );

      if (optimalPaths.length === 0) {
        throw new Error('조건에 맞는 자전거 경로를 찾을 수 없습니다.');
      }

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
        const routeId =
          bikePath?.routeId ||
          this.routeOptimizer.createRouteId(bikePath ?? route);

        const routeDto = {
          routeCategory: route.routeCategory,
          routeId,
          summary: route.summary,
          bbox: route.bbox,
          startStation: route.startStation,
          endStation: route.endStation,
          segments: route.segments,
        };

        // Redis에 instructions 포함하여 저장
        this.routeOptimizer.saveRouteToRedis(routeId, routeDto);

        routes.push(routeDto);
      }

      this.logger.debug(
        `다구간 경로 검색 완료 - 출발: ${startStation.name}, 도착: ${endStation.name}, 경로 ${routes.length}개`,
      );

      return routes;
    } catch (error) {
      this.logger.error(
        '다구간 경로 검색 실패',
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }
}
