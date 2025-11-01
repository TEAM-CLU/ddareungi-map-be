import { Injectable } from '@nestjs/common';
import {
  RouteDto,
  RouteSegmentDto,
  SummaryDto,
  BoundingBoxDto,
  GeometryDto,
  BikeProfile,
  InstructionDto,
  RouteStationDto,
} from '../dto/route.dto';
import { GraphHopperPath } from '../interfaces/graphhopper.interface';
import { CategorizedPath } from './route-optimizer.service';
import { RouteUtilService } from './route-util.service';

/**
 * 상수 정의
 */
const DEFAULT_CATEGORY = '일반 경로';

/**
 * RouteConverterService
 * GraphHopper API 응답을 애플리케이션 DTO로 변환하는 서비스
 */
@Injectable()
export class RouteConverterService {
  constructor(private readonly routeUtil: RouteUtilService) {}

  // ============================================================================
  // Public API - Route Building
  // ============================================================================

  /**
   * 3개 구간 경로 생성 (도보 → 자전거 → 도보)
   * @param walkingToStart 출발지에서 시작 정류장까지 도보 경로
   * @param bikeRoute 시작 정류장에서 도착 정류장까지 자전거 경로
   * @param walkingFromEnd 도착 정류장에서 목적지까지 도보 경로
   * @param startStation 시작 정류장
   * @param endStation 도착 정류장
   * @param routeCategory 경로 카테고리
   * @returns 완성된 RouteDto
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
      routeCategory: routeCategory || DEFAULT_CATEGORY,
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
   * 원형 경로 생성 (도보 → 자전거(순환) → 도보)
   * @param walkingToStation 출발지에서 정류장까지 도보 경로
   * @param circularBikeRoute 순환 자전거 경로
   * @param walkingToStart 정류장에서 출발지까지 도보 경로
   * @param station 정류장 정보
   * @param routeCategory 경로 카테고리
   * @returns 완성된 RouteDto
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

    // CategorizedPath 타입인 경우 routeCategory 우선 사용
    let category = routeCategory;
    if (
      !category &&
      'routeCategory' in circularBikeRoute &&
      typeof (circularBikeRoute as CategorizedPath).routeCategory === 'string'
    ) {
      category = (circularBikeRoute as CategorizedPath).routeCategory;
    }

    return {
      routeCategory: category || DEFAULT_CATEGORY,
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
   * 4개 구간 왕복 경로 생성 (도보 → 자전거(왕로) → 자전거(복로) → 도보)
   * @param walkingToStation 출발지에서 정류장까지 도보 경로
   * @param bikeToDestination 정류장에서 목적지까지 자전거 경로 (왕로)
   * @param bikeToStation 목적지에서 정류장까지 자전거 경로 (복로)
   * @param walkingToStart 정류장에서 출발지까지 도보 경로
   * @param station 정류장 정보
   * @param routeCategory 경로 카테고리
   * @returns 완성된 RouteDto
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
      routeCategory: routeCategory || DEFAULT_CATEGORY,
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
   * 왕복 경로 배열 생성 (카테고리별로 왕로와 복로 매칭)
   * @param outboundPaths 왕로 경로 배열
   * @param returnPaths 복로 경로 배열
   * @param walkingToStation 출발지에서 정류장까지 도보 경로
   * @param walkingFromStation 정류장에서 출발지까지 도보 경로
   * @param station 정류장 정보
   * @returns 왕복 경로 배열
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
   * 경로 세그먼트 생성 (instructions 포함)
   * @param type 세그먼트 타입 (walking 또는 biking)
   * @param path GraphHopper 경로 데이터
   * @returns 세그먼트 DTO
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
      instructions: this.convertInstructions(path.instructions),
    };
  }

  /**
   * GraphHopper 경로를 RouteSegmentDto로 변환 (프로필 자동 감지)
   * @param routeData GraphHopper 경로 데이터
   * @returns 세그먼트 DTO
   */
  convertToRouteSegment(routeData: GraphHopperPath): RouteSegmentDto {
    const isWalking = routeData.profile === 'foot';
    return this.buildSegment(isWalking ? 'walking' : 'biking', routeData);
  }

  // ============================================================================
  // Public API - Conversion Utilities
  // ============================================================================

  /**
   * GraphHopper Path를 SummaryDto로 변환
   * @param path GraphHopper 경로 데이터
   * @param includeBikeRoadRatio 자전거 도로 비율 포함 여부
   * @returns 요약 정보 DTO
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
   * @param bbox [minLng, minLat, maxLng, maxLat]
   * @returns BoundingBox DTO
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
   * @param points 좌표 배열
   * @returns Geometry DTO
   */
  convertToGeometry(points: { coordinates: number[][] }): GeometryDto {
    return {
      points: points.coordinates,
    };
  }

  /**
   * 여러 BoundingBox의 전체 범위 계산
   * @param bboxes BoundingBox 배열
   * @returns 전체를 포함하는 BoundingBox
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
   * 여러 GraphHopper 경로의 전체 BoundingBox 계산
   * @param paths GraphHopper 경로 배열
   * @returns 전체를 포함하는 BoundingBox
   */
  calculateBoundingBoxFromPaths(paths: GraphHopperPath[]): BoundingBoxDto {
    return this.routeUtil.calculateOverallBounds(paths);
  }

  // ============================================================================
  // Public API - Instructions Handling
  // ============================================================================

  /**
   * RouteDto에서 instructions 제거 (API 응답용)
   * @param route 경로 DTO
   * @returns instructions가 제거된 경로 DTO
   */
  static removeInstructions(route: RouteDto): RouteDto {
    return {
      ...route,
      segments: route.segments.map((segment) => {
        const { instructions: _, ...segmentWithoutInstructions } = segment;
        return segmentWithoutInstructions;
      }),
    };
  }

  /**
   * RouteDto 배열에서 instructions 제거 (API 응답용)
   * @param routes 경로 DTO 배열
   * @returns instructions가 제거된 경로 DTO 배열
   */
  static removeInstructionsFromRoutes(routes: RouteDto[]): RouteDto[] {
    return routes.map((route) =>
      RouteConverterService.removeInstructions(route),
    );
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * GraphHopper instructions를 InstructionDto로 변환 (시간 단위 변환: ms → 초)
   * @param instructions GraphHopper instruction 배열
   * @returns InstructionDto 배열
   */
  private convertInstructions(
    instructions: GraphHopperPath['instructions'],
  ): InstructionDto[] {
    return instructions.map((inst) => ({
      distance: Math.round(inst.distance),
      time: Math.round(inst.time / 1000),
      text: inst.text,
      sign: inst.sign,
      interval: inst.interval,
    }));
  }

  /**
   * GraphHopper 프로필 문자열을 BikeProfile enum으로 변환
   * @param profile 프로필 문자열 ('safe_bike' 또는 'fast_bike')
   * @returns BikeProfile enum 또는 undefined
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
   * 여러 GraphHopper 경로로부터 전체 Summary 계산
   * @param paths GraphHopper 경로 배열
   * @param segments 세그먼트 배열 (자전거 도로 비율 계산용)
   * @param maxGradient 최대 경사도
   * @returns Summary DTO
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
}
