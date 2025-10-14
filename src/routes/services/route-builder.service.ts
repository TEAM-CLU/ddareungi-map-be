import { Injectable, Logger } from '@nestjs/common';
import {
  RouteDto,
  RouteSegmentDto,
  SummaryDto,
  BoundingBoxDto,
  CoordinateDto,
} from '../dto/route.dto';
import { RouteConverterService } from './route-converter.service';
import { GraphHopperService } from './graphhopper.service';
import { GraphHopperPath } from '../interfaces/graphhopper.interface';

/**
 * 경로 구성 전담 서비스
 * 다구간 경로, 왕복 경로 등 복잡한 경로 구성 로직을 담당
 */
@Injectable()
export class RouteBuilderService {
  private readonly logger = new Logger(RouteBuilderService.name);

  constructor(
    private readonly routeConverter: RouteConverterService,
    private readonly graphHopperService: GraphHopperService,
  ) {}

  /**
   * 다구간 경로 구축 (도보 구간 포함)
   */
  async buildMultiLegRoute(
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
    let totalBikeDistance = 0;
    let totalBikeRoadDistance = 0;

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

      // 자전거 구간 세그먼트로 변환 (자전거 도로 비율 포함)
      const bikeSummary = this.routeConverter.convertToSummary(
        selectedRoute,
        true,
      );
      const segment = this.routeConverter.convertToRouteSegment(selectedRoute);
      segment.summary = bikeSummary;
      segments.push(segment);

      // 총합 계산
      totalDistance += selectedRoute.distance;
      totalTime += selectedRoute.time;
      totalAscent += selectedRoute.ascend || 0;
      totalDescent += selectedRoute.descend || 0;

      // 자전거 도로 길이 계산
      totalBikeDistance += selectedRoute.distance;
      if (bikeSummary.bikeRoadRatio) {
        totalBikeRoadDistance +=
          selectedRoute.distance * bikeSummary.bikeRoadRatio;
      }
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

    // 전체 경로의 자전거 도로 비율 계산
    const overallBikeRoadRatio =
      totalBikeDistance > 0
        ? Math.round((totalBikeRoadDistance / totalBikeDistance) * 100) / 100
        : 0;

    // 전체 경계 상자 계산
    const bbox = this.calculateBoundingBox(segments);

    return {
      routeCategory: category.name,
      summary: {
        distance: totalDistance,
        time: totalTime,
        ascent: totalAscent,
        descent: totalDescent,
        bikeRoadRatio: overallBikeRoadRatio,
      },
      bbox,
      segments,
    };
  }

  /**
   * 왕복 경로 통합
   */
  mergeRoundTripRoutes(
    forwardRoute: RouteDto,
    returnRoute: RouteDto,
  ): RouteDto {
    // 자전거 구간의 총 거리와 자전거 도로 거리 계산
    const forwardBikeSegments = forwardRoute.segments.filter(
      (s) => s.type === 'biking',
    );
    const returnBikeSegments = returnRoute.segments.filter(
      (s) => s.type === 'biking',
    );

    let totalBikeDistance = 0;
    let totalBikeRoadDistance = 0;

    // 전진 경로의 자전거 구간 계산
    forwardBikeSegments.forEach((segment) => {
      totalBikeDistance += segment.summary.distance;
      if (segment.summary.bikeRoadRatio) {
        totalBikeRoadDistance +=
          segment.summary.distance * segment.summary.bikeRoadRatio;
      }
    });

    // 복귀 경로의 자전거 구간 계산
    returnBikeSegments.forEach((segment) => {
      totalBikeDistance += segment.summary.distance;
      if (segment.summary.bikeRoadRatio) {
        totalBikeRoadDistance +=
          segment.summary.distance * segment.summary.bikeRoadRatio;
      }
    });

    // 전체 자전거 도로 비율 계산
    const overallBikeRoadRatio =
      totalBikeDistance > 0
        ? Math.round((totalBikeRoadDistance / totalBikeDistance) * 100) / 100
        : 0;

    return {
      routeCategory: forwardRoute.routeCategory,
      summary: {
        distance: forwardRoute.summary.distance + returnRoute.summary.distance,
        time: forwardRoute.summary.time + returnRoute.summary.time,
        ascent: forwardRoute.summary.ascent + returnRoute.summary.ascent,
        descent: forwardRoute.summary.descent + returnRoute.summary.descent,
        bikeRoadRatio: overallBikeRoadRatio,
      },
      bbox: this.mergeBoundingBoxes(forwardRoute.bbox, returnRoute.bbox),
      segments: [...forwardRoute.segments, ...returnRoute.segments],
    };
  }

  /**
   * 카테고리에 따른 최적 경로 선택
   */
  selectRouteByCategory(
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
  calculateBoundingBox(segments: RouteSegmentDto[]): BoundingBoxDto {
    const allBboxes = segments.map((s) => s.bbox);

    return {
      minLat: Math.min(...allBboxes.map((b) => b.minLat)),
      minLng: Math.min(...allBboxes.map((b) => b.minLng)),
      maxLat: Math.max(...allBboxes.map((b) => b.maxLat)),
      maxLng: Math.max(...allBboxes.map((b) => b.maxLng)),
    };
  }

  /**
   * 경계 상자 통합
   */
  mergeBoundingBoxes(
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
}
