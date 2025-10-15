import { Injectable } from '@nestjs/common';
import {
  RouteDto,
  RouteSegmentDto,
  SummaryDto,
  BoundingBoxDto,
  GeometryDto,
  BikeProfile,
} from '../dto/route.dto';
import { GraphHopperPath } from '../interfaces/graphhopper.interface';
import { CategorizedPath } from './route-optimizer.service';
import { RouteStationDto } from '../dto/route.dto';
import { RouteUtilService } from './route-util.service';

@Injectable()
export class RouteConverterService {
  private static readonly DEFAULT_CATEGORY = '일반 경로';
  constructor(private readonly routeUtil: RouteUtilService) {}

  /**
   * GraphHopper 프로필 문자열을 BikeProfile enum으로 변환
   */
  private convertToBikeProfile(profile?: string): BikeProfile | undefined {
    switch (profile) {
      case 'safe_bike':
        return BikeProfile.SAFE_BIKE;
      case 'fast_bike':
        return BikeProfile.FAST_BIKE;
      default:
        return undefined;
    }
  }

  /**
   * 여러 GraphHopperPath를 받아 summary를 계산 (중복 제거)
   */
  private buildSummary(
    paths: GraphHopperPath[],
    segments: RouteSegmentDto[],
    maxGradient?: number,
  ): SummaryDto {
    const totalDistance = paths.reduce((sum, p) => sum + p.distance, 0);
    const totalTime = paths.reduce((sum, p) => sum + p.time, 0);
    const totalAscent = paths.reduce((sum, p) => sum + p.ascend, 0);
    const totalDescent = paths.reduce((sum, p) => sum + p.descend, 0);
    // 자전거 구간만 추출
    const bikeSegments = segments.filter((s) => s.type === 'biking');
    return {
      distance: Math.round(totalDistance),
      time: Math.round(totalTime / 1000),
      ascent: Math.round(totalAscent),
      descent: Math.round(totalDescent),
      bikeRoadRatio: this.routeUtil.calculateOverallBikeRoadRatio(bikeSegments),
      maxGradient,
    };
  }

  /**
   * GraphHopper 경로 3개(도보-자전거-도보)로 RouteDto 생성
   */
  buildRouteFromGraphHopper(
    walkingToStart: GraphHopperPath,
    bikeRoute: GraphHopperPath,
    walkingFromEnd: GraphHopperPath,
    startStation: RouteStationDto,
    endStation: RouteStationDto,
    routeCategory?: string,
  ): RouteDto {
    const segments: RouteSegmentDto[] = [
      this.buildSegment('walking', walkingToStart),
      this.buildSegment('biking', bikeRoute),
      this.buildSegment('walking', walkingFromEnd),
    ];
    const summary = this.buildSummary(
      [walkingToStart, bikeRoute, walkingFromEnd],
      segments,
      segments[1].summary.maxGradient,
    );
    return {
      routeCategory: routeCategory || RouteConverterService.DEFAULT_CATEGORY,
      summary,
      bbox: this.calculateBoundingBoxFromPaths([
        walkingToStart,
        bikeRoute,
        walkingFromEnd,
      ]),
      startStation,
      endStation,
      segments,
    };
  }

  /**
   * GraphHopper Path를 SummaryDto로 변환
   */
  convertToSummary(
    path: GraphHopperPath,
    includeBikeRoadRatio?: boolean,
  ): SummaryDto {
    const summary: SummaryDto = {
      distance: Math.round(path.distance),
      time: Math.round(path.time / 1000),
      ascent: Math.round(path.ascend),
      descent: Math.round(path.descend),
    };
    if (
      includeBikeRoadRatio &&
      (path.profile === 'safe_bike' || path.profile === 'fast_bike')
    ) {
      summary.bikeRoadRatio =
        Math.round(this.routeUtil.calculateBikeRoadRatio(path) * 100) / 100;
      summary.maxGradient = this.routeUtil.calculateMaxGradient(path);
    }
    return summary;
  }

  /**
   * GraphHopper bbox를 BoundingBoxDto로 변환
   */
  convertToBoundingBox(bbox: [number, number, number, number]): BoundingBoxDto {
    return {
      minLng: bbox[0],
      minLat: bbox[1],
      maxLng: bbox[2],
      maxLat: bbox[3],
    };
  }

  /**
   * GraphHopper points를 GeometryDto로 변환
   */
  convertToGeometry(points: { coordinates: number[][] }): GeometryDto {
    return {
      points: points.coordinates,
    };
  }

  /**
   * 여러 BoundingBox의 전체 범위 계산
   */
  calculateOverallBoundingBox(bboxes: BoundingBoxDto[]): BoundingBoxDto {
    return {
      minLat: Math.min(...bboxes.map((bbox) => bbox.minLat)),
      minLng: Math.min(...bboxes.map((bbox) => bbox.minLng)),
      maxLat: Math.max(...bboxes.map((bbox) => bbox.maxLat)),
      maxLng: Math.max(...bboxes.map((bbox) => bbox.maxLng)),
    };
  }

  /**
   * 모든 GraphHopper 경로의 좌표점으로부터 전체 bbox 계산
   */
  calculateBoundingBoxFromPaths(paths: GraphHopperPath[]): BoundingBoxDto {
    return this.routeUtil.calculateOverallBounds(paths);
  }

  /**
   * 경로 세그먼트 생성 (type에 따라 분기)
   */
  buildSegment(
    type: 'walking' | 'biking',
    path: GraphHopperPath,
  ): RouteSegmentDto {
    return {
      type,
      summary: this.convertToSummary(path, type === 'biking'),
      bbox: this.convertToBoundingBox(path.bbox),
      geometry: this.convertToGeometry(path.points),
      profile:
        type === 'biking' ? this.convertToBikeProfile(path.profile) : undefined,
    };
  }

  /**
   * 왕복 경로를 RouteDto로 변환 (도보→자전거→자전거→도보)
   */
  buildDirectRoundTripRoute(
    walkingToStation: GraphHopperPath,
    bikeToDestination: GraphHopperPath,
    bikeToStation: GraphHopperPath,
    walkingToStart: GraphHopperPath,
    station: RouteStationDto,
    routeCategory?: string,
  ): RouteDto {
    const segments: RouteSegmentDto[] = [
      this.buildSegment('walking', walkingToStation),
      this.buildSegment('biking', bikeToDestination),
      this.buildSegment('biking', bikeToStation),
      this.buildSegment('walking', walkingToStart),
    ];
    const maxBikeGradient = Math.max(
      this.routeUtil.calculateMaxGradient(bikeToDestination),
      this.routeUtil.calculateMaxGradient(bikeToStation),
    );
    const summary = this.buildSummary(
      [walkingToStation, bikeToDestination, bikeToStation, walkingToStart],
      segments,
      maxBikeGradient > 0 ? maxBikeGradient : undefined,
    );
    return {
      routeCategory: routeCategory || RouteConverterService.DEFAULT_CATEGORY,
      summary,
      bbox: this.calculateBoundingBoxFromPaths([
        walkingToStation,
        bikeToDestination,
        bikeToStation,
        walkingToStart,
      ]),
      startStation: station,
      endStation: station,
      segments,
    };
  }

  /**
   * 원형 경로를 RouteDto로 변환 (도보→자전거→도보)
   */
  buildCircularRoute(
    walkingToStation: GraphHopperPath,
    circularBikeRoute: GraphHopperPath,
    walkingToStart: GraphHopperPath,
    station: RouteStationDto,
    routeCategory?: string,
  ): RouteDto {
    const segments: RouteSegmentDto[] = [
      this.buildSegment('walking', walkingToStation),
      this.buildSegment('biking', circularBikeRoute),
      this.buildSegment('walking', walkingToStart),
    ];
    const summary = this.buildSummary(
      [walkingToStation, circularBikeRoute, walkingToStart],
      segments,
      segments[1].summary.maxGradient,
    );
    // CategorizedPath 타입이면 circularBikeRoute.routeCategory를 우선 사용
    let category = routeCategory;
    if (
      !category &&
      'routeCategory' in circularBikeRoute &&
      typeof (circularBikeRoute as CategorizedPath).routeCategory === 'string'
    ) {
      category = (circularBikeRoute as CategorizedPath).routeCategory;
    }
    return {
      routeCategory: category || RouteConverterService.DEFAULT_CATEGORY,
      summary,
      bbox: this.calculateBoundingBoxFromPaths([
        walkingToStation,
        circularBikeRoute,
        walkingToStart,
      ]),
      startStation: station,
      endStation: station,
      segments,
    };
  }

  /**
   * 왕복 경로의 outbound와 return 경로를 카테고리별로 매칭하여 RouteDto[] 생성
   */
  buildRoundTripRoutesFromPaths(
    outboundPaths: CategorizedPath[],
    returnPaths: CategorizedPath[],
    walkingToStation: GraphHopperPath,
    walkingFromStation: GraphHopperPath,
    station: RouteStationDto,
  ): RouteDto[] {
    const roundTripRoutes: RouteDto[] = [];
    const maxRoutes = Math.min(outboundPaths.length, returnPaths.length);
    for (let i = 0; i < maxRoutes; i++) {
      roundTripRoutes.push(
        this.buildDirectRoundTripRoute(
          walkingToStation,
          outboundPaths[i],
          returnPaths[i],
          walkingFromStation,
          station,
          outboundPaths[i].routeCategory,
        ),
      );
    }
    return roundTripRoutes;
  }

  /**
   * GraphHopper 경로를 RouteSegmentDto로 변환 (다구간 경로용)
   */
  convertToRouteSegment(routeData: GraphHopperPath): RouteSegmentDto {
    const isWalking = routeData.profile === 'foot';
    return this.buildSegment(isWalking ? 'walking' : 'biking', routeData);
  }
}
