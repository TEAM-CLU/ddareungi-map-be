import { Injectable, Logger } from '@nestjs/common';
import {
  RouteDto,
  RouteSegmentDto,
  SummaryDto,
  BoundingBoxDto,
  CoordinateDto,
  RouteStationDto,
} from '../dto/route.dto';
import { RouteConverterService } from './route-converter.service';
import { GraphHopperService } from './graphhopper.service';
import { GraphHopperPath } from '../interfaces/graphhopper.interface';

/**
 * 상수 정의
 */
const CATEGORY_PRIORITY = {
  bike: 'bike_priority',
  time: 'time',
  distance: 'distance',
} as const;

/**
 * RouteBuilderService
 * 다구간 경로 및 복합 경로 구성을 담당하는 서비스
 */
@Injectable()
export class RouteBuilderService {
  private readonly logger = new Logger(RouteBuilderService.name);

  constructor(
    private readonly routeConverter: RouteConverterService,
    private readonly graphHopperService: GraphHopperService,
  ) {}

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * 다구간 경로 구축 (도보 구간 포함)
   * @param points 경유지 좌표 배열
   * @param category 경로 카테고리 정보 (이름 및 우선순위)
   * @param walkingToStart 출발지에서 시작 정류장까지 도보 경로
   * @param walkingFromEnd 도착 정류장에서 목적지까지 도보 경로
   * @param startStation 시작 정류장 정보
   * @param endStation 도착 정류장 정보
   * @returns 완성된 다구간 경로
   */
  async buildMultiLegRoute(
    points: CoordinateDto[],
    category: { name: string; priority: string },
    walkingToStart?: GraphHopperPath,
    walkingFromEnd?: GraphHopperPath,
    startStation?: RouteStationDto,
    endStation?: RouteStationDto,
  ): Promise<RouteDto> {
    const segments: RouteSegmentDto[] = [];
    let totalDistance = 0;
    let totalTime = 0;
    let totalAscent = 0;
    let totalDescent = 0;
    let totalBikeDistance = 0;
    let totalBikeRoadDistance = 0;
    let maxGradient = 0;

    // 첫 번째 도보 구간 추가 (출발지 → 시작 대여소)
    if (walkingToStart) {
      const walkingSummary = this.routeConverter.convertToSummary(
        walkingToStart,
        false,
      );
      const walkingSegment =
        this.routeConverter.convertToRouteSegment(walkingToStart);
      walkingSegment.type = 'walking';
      walkingSegment.summary = walkingSummary;
      segments.push(walkingSegment);

      totalDistance += walkingSummary.distance;
      totalTime += walkingSummary.time;
      totalAscent += walkingSummary.ascent || 0;
      totalDescent += walkingSummary.descent || 0;
    }

    // 각 자전거 구간별로 경로 검색 및 추가
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

      // 자전거 구간 세그먼트로 변환 (자전거 도로 비율 포함)
      const bikeSummary = this.routeConverter.convertToSummary(
        selectedRoute,
        true,
      );
      const segment = this.routeConverter.convertToRouteSegment(selectedRoute);
      segment.summary = bikeSummary;
      segments.push(segment);

      // 총합 계산
      totalDistance += bikeSummary.distance;
      totalTime += bikeSummary.time;
      totalAscent += bikeSummary.ascent || 0;
      totalDescent += bikeSummary.descent || 0;

      // 자전거 도로 길이 계산
      totalBikeDistance += bikeSummary.distance;
      if (bikeSummary.bikeRoadRatio) {
        totalBikeRoadDistance +=
          bikeSummary.distance * bikeSummary.bikeRoadRatio;
      }

      // 최대 경사도 업데이트 (자전거 구간에서만)
      if (bikeSummary.maxGradient) {
        maxGradient = Math.max(maxGradient, bikeSummary.maxGradient);
      }
    }

    // 마지막 도보 구간 추가 (도착 대여소 → 도착지)
    if (walkingFromEnd) {
      const walkingSummary = this.routeConverter.convertToSummary(
        walkingFromEnd,
        false,
      );
      const walkingSegment =
        this.routeConverter.convertToRouteSegment(walkingFromEnd);
      walkingSegment.type = 'walking';
      walkingSegment.summary = walkingSummary;
      segments.push(walkingSegment);

      totalDistance += walkingSummary.distance;
      totalTime += walkingSummary.time;
      totalAscent += walkingSummary.ascent || 0;
      totalDescent += walkingSummary.descent || 0;
    }

    // 전체 경로의 자전거 도로 비율 계산
    const overallBikeRoadRatio =
      totalBikeDistance > 0
        ? Math.round((totalBikeRoadDistance / totalBikeDistance) * 100) / 100
        : 0;

    // 전체 경계 상자 계산
    const bbox = this.calculateBoundingBox(segments);

    const summary: SummaryDto = {
      distance: Math.round(totalDistance),
      time: Math.round(totalTime),
      ascent: Math.round(totalAscent),
      descent: Math.round(totalDescent),
      bikeRoadRatio: overallBikeRoadRatio,
      maxGradient: maxGradient > 0 ? maxGradient : undefined,
    };

    return {
      routeCategory: category.name,
      summary,
      bbox,
      startStation,
      endStation,
      segments,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 카테고리 우선순위에 따라 경로 선택
   * @param routes 경로 배열
   * @param priority 우선순위 (bike_priority, time, distance)
   * @returns 선택된 경로
   */
  private selectRouteByCategory(
    routes: GraphHopperPath[],
    priority: string,
  ): GraphHopperPath {
    switch (priority) {
      case CATEGORY_PRIORITY.bike: {
        const safeRoutes = routes.filter((r) => r.profile === 'safe_bike');
        return safeRoutes.sort((a, b) => a.time - b.time)[0] || routes[0];
      }
      case CATEGORY_PRIORITY.time:
        return routes.sort((a, b) => a.time - b.time)[0];
      case CATEGORY_PRIORITY.distance:
        return routes.sort((a, b) => a.distance - b.distance)[0];
      default:
        return routes[0];
    }
  }

  /**
   * 세그먼트들의 경계 상자 계산
   * @param segments 경로 세그먼트 배열
   * @returns 전체 경계 상자
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
}
