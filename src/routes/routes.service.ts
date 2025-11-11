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
import { RouteUtilService } from './services/route-util.service';

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    private readonly routeOptimizer: RouteOptimizerService,
    private readonly routeConverter: RouteConverterService,
    private readonly routeBuilder: RouteBuilderService,
    private readonly graphHopperService: GraphHopperService,
    private readonly stationRouteService: StationRouteService,
    private readonly routeUtil: RouteUtilService,
  ) {}

  // ===== 컨트롤러 호출 메서드 (Public API) =====

  /** 통합 경로 검색 (A → B, 왕복, 경유지 포함) */
  async findFullJourney(request: FullJourneyRequestDto): Promise<RouteDto[]> {
    try {
      this.routeUtil.validateCoordinate(request.start, '출발지');
      this.routeUtil.validateCoordinate(request.end, '도착지');

      const isRoundTrip = this.routeUtil.isSameLocation(
        request.start,
        request.end,
      );

      if (isRoundTrip) {
        if (!request.waypoints || request.waypoints.length === 0) {
          throw new Error(
            '왕복 경로 검색에는 최소한 하나의 경유지가 필요합니다.',
          );
        }
        const routes = await this.findRoundTripJourney(request);
        // 클라이언트 응답에서는 instructions 제거
        return routes.map((route) => this.removeInstructionsFromRoute(route));
      }

      if (request.waypoints && request.waypoints.length > 0) {
        request.waypoints.forEach((wp, idx) =>
          this.routeUtil.validateCoordinate(wp, `경유지 ${idx + 1}`),
        );
        const routes = await this.findMultiLegJourney(request);
        // 클라이언트 응답에서는 instructions 제거
        return routes.map((route) => this.removeInstructionsFromRoute(route));
      }

      const routes = await this.findDirectJourney(request);
      // 클라이언트 응답에서는 instructions 제거
      return routes.map((route) => this.removeInstructionsFromRoute(route));
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
      this.routeUtil.validateCoordinate(request.start, '시작 위치');

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

        // 원형 경로는 경유지가 없음 (출발지 = 도착지)
        const routeDto = this.createRouteDto(
          route,
          circularPath.routeId || '',
          undefined,
        );

        // Redis에 instructions 포함하여 저장 (네비게이션용)
        if (circularPath.routeId) {
          this.routeOptimizer.saveRouteToRedis(circularPath.routeId, routeDto, {
            routeType: 'circular',
            origin: request.start,
            destination: request.start,
            waypoints: undefined,
            targetDistance: request.targetDistance,
          });
        }

        // 클라이언트 응답에서는 instructions 제거
        return this.removeInstructionsFromRoute(routeDto);
      });

      return routes;
    } catch (error) {
      this.logger.error(
        '원형 경로 추천 실패',
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  // ===== 경로 검색 타입 판별 및 라우팅 =====

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

      // instructions 포함하여 검색 (Redis 저장 및 네비게이션용)
      const [walkingToStation, walkingFromStation] = await Promise.all([
        this.graphHopperService.getSingleRoute(
          start,
          startStation,
          'foot',
          true,
        ),
        this.graphHopperService.getSingleRoute(
          startStation,
          start,
          'foot',
          true,
        ),
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
        const routeDto = this.createRouteDto(route, routeId, waypoints);

        // Redis에 instructions 및 메타데이터 포함하여 저장
        this.routeOptimizer.saveRouteToRedis(routeId, routeDto, {
          routeType: 'roundtrip',
          origin: start,
          destination: start,
          waypoints: waypoints,
        });

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

      // instructions 포함하여 검색 (Redis 저장 및 네비게이션용)
      const [walkingToStart, walkingFromEnd] = await Promise.all([
        this.graphHopperService.getSingleRoute(
          request.start,
          startStation,
          'foot',
          true,
        ),
        this.graphHopperService.getSingleRoute(
          endStation,
          request.end,
          'foot',
          true,
        ),
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

      const routes = optimalBikePaths.map((bikePath: CategorizedPath) => {
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

        const routeDto = this.createRouteDto(route, routeId, request.waypoints);

        // Redis에 instructions 및 메타데이터 포함하여 저장
        this.routeOptimizer.saveRouteToRedis(routeId, routeDto, {
          routeType: 'direct',
          origin: request.start,
          destination: request.end,
          waypoints: request.waypoints,
        });

        return routeDto;
      });

      return routes;
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

      // instructions 포함하여 검색 (Redis 저장 및 네비게이션용)
      const [walkingToStart, walkingFromEnd] = await Promise.all([
        this.graphHopperService.getSingleRoute(
          start,
          startStation,
          'foot',
          true,
        ),
        this.graphHopperService.getSingleRoute(endStation, end, 'foot', true),
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

        const routeDto = this.createRouteDto(route, routeId, waypoints);

        // Redis에 instructions 및 메타데이터 포함하여 저장
        this.routeOptimizer.saveRouteToRedis(routeId, routeDto, {
          routeType: 'multi-leg',
          origin: start,
          destination: end,
          waypoints: waypoints,
        });

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

  // ===== Private Helper Methods =====

  /**
   * RouteDto 생성 헬퍼 (중복 코드 제거)
   */
  private createRouteDto(
    route: RouteDto,
    routeId: string,
    waypoints?: CoordinateDto[],
  ): RouteDto {
    return {
      routeCategory: route.routeCategory,
      routeId,
      summary: route.summary,
      bbox: route.bbox,
      startStation: route.startStation,
      endStation: route.endStation,
      waypoints,
      segments: route.segments,
    };
  }

  /**
   * 클라이언트 응답용 RouteDto 생성 (instructions 제거 + coordinates 통합)
   */
  private removeInstructionsFromRoute(route: RouteDto): RouteDto {
    // 모든 세그먼트의 좌표를 통합
    const coordinates: [number, number][] = [];
    for (const segment of route.segments) {
      if (segment.geometry && segment.geometry.points) {
        for (const point of segment.geometry.points) {
          const [lng, lat] = point;
          coordinates.push([lng, lat]);
        }
      }
    }

    return {
      ...route,
      coordinates,
      segments: route.segments.map((segment) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { instructions, geometry, ...segmentWithoutGeometry } = segment;
        return segmentWithoutGeometry;
      }),
    };
  }
}
