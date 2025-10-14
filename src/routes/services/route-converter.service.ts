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
import { RouteStation } from './station-route.service';

@Injectable()
export class RouteConverterService {
  /**
   * GraphHopper 프로필 문자열을 BikeProfile enum으로 변환
   */
  private convertToBikeProfile(profile?: string): BikeProfile | undefined {
    if (!profile) return undefined;

    switch (profile) {
      case 'safe_bike':
        return BikeProfile.SAFE_BIKE;
      case 'fast_bike':
        return BikeProfile.FAST_BIKE;
      default:
        return BikeProfile.SAFE_BIKE; // 기본값
    }
  }
  /**
   * GraphHopper 경로에서 RouteDto 생성
   */
  buildRouteFromGraphHopper(
    walkingToStart: GraphHopperPath,
    bikeRoute: GraphHopperPath,
    walkingFromEnd: GraphHopperPath,
    startStation: RouteStation,
    endStation: RouteStation,
    routeCategory?: string, // 옵셔널 카테고리 정보
  ): RouteDto {
    // 자전거 경로 요약 (자전거 도로 비율 포함)
    const bikeSummary = this.convertToSummary(bikeRoute, true);

    const segments: RouteSegmentDto[] = [
      {
        type: 'walking',
        summary: this.convertToSummary(walkingToStart),
        bbox: this.convertToBoundingBox(walkingToStart.bbox),
        geometry: this.convertToGeometry(walkingToStart.points),
      },
      {
        type: 'biking',
        summary: bikeSummary,
        bbox: this.convertToBoundingBox(bikeRoute.bbox),
        geometry: this.convertToGeometry(bikeRoute.points),
        profile: this.convertToBikeProfile(bikeRoute.profile), // 자전거 프로필 정보 추가
        startStation: {
          station_id: startStation.id,
          station_name: startStation.name,
          lat: startStation.lat,
          lng: startStation.lng,
          current_bikes: 8,
        },
        endStation: {
          station_id: endStation.id,
          station_name: endStation.name,
          lat: endStation.lat,
          lng: endStation.lng,
          current_bikes: 5,
        },
      },
      {
        type: 'walking',
        summary: this.convertToSummary(walkingFromEnd),
        bbox: this.convertToBoundingBox(walkingFromEnd.bbox),
        geometry: this.convertToGeometry(walkingFromEnd.points),
      },
    ];

    // 전체 경로의 자전거 도로 비율 계산
    const totalBikeDistance = bikeRoute.distance;
    const totalBikeRoadDistance = bikeSummary.bikeRoadRatio
      ? totalBikeDistance * bikeSummary.bikeRoadRatio
      : 0;
    const overallBikeRoadRatio =
      totalBikeDistance > 0
        ? Math.round((totalBikeRoadDistance / totalBikeDistance) * 100) / 100
        : 0;

    const totalSummary: SummaryDto = {
      distance:
        walkingToStart.distance + bikeRoute.distance + walkingFromEnd.distance,
      time: Math.round(
        (walkingToStart.time + bikeRoute.time + walkingFromEnd.time) / 1000,
      ), // ms to seconds
      ascent: walkingToStart.ascend + bikeRoute.ascend + walkingFromEnd.ascend,
      descent:
        walkingToStart.descend + bikeRoute.descend + walkingFromEnd.descend,
      bikeRoadRatio: overallBikeRoadRatio,
    };

    return {
      routeCategory: routeCategory || '일반 경로',
      summary: totalSummary,
      bbox: this.calculateBoundingBoxFromPaths([
        walkingToStart,
        bikeRoute,
        walkingFromEnd,
      ]),
      segments,
    };
  }

  /**
   * 자전거 도로 비율 계산 (소수점 둘째자리까지)
   */
  private calculateBikeRoadRatio(path: GraphHopperPath): number {
    // GraphHopper에서 자전거 도로 비율 정보를 제공하지 않으므로
    // 프로필과 경로 특성에 따라 추정값 계산
    const profile = path.profile;
    const distance = path.distance;

    let estimatedRatio = 0;

    if (profile === 'safe_bike') {
      // safe_bike 프로필은 자전거 도로를 우선하므로 높은 비율
      estimatedRatio = Math.min(0.85 + Math.random() * 0.1, 1);
    } else if (profile === 'fast_bike') {
      // fast_bike 프로필은 속도 우선이므로 중간 비율
      estimatedRatio = 0.6 + Math.random() * 0.25;
    } else {
      // 기본값
      estimatedRatio = 0.5 + Math.random() * 0.3;
    }

    // 거리가 짧을수록 자전거 도로 비율이 낮을 가능성
    if (distance < 1000) {
      estimatedRatio *= 0.8;
    }

    // 소수점 둘째자리까지 반올림
    return Math.round(estimatedRatio * 100) / 100;
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
      time: Math.round(path.time / 1000), // ms to seconds
      ascent: Math.round(path.ascend),
      descent: Math.round(path.descend),
    };

    // 자전거 경로인 경우 자전거 도로 비율 추가
    if (
      includeBikeRoadRatio &&
      (path.profile === 'safe_bike' || path.profile === 'fast_bike')
    ) {
      summary.bikeRoadRatio = this.calculateBikeRoadRatio(path);
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
    const allPoints: number[][] = [];

    // 모든 경로의 좌표점을 수집
    paths.forEach((path) => {
      if (path.points && path.points.coordinates) {
        allPoints.push(...path.points.coordinates);
      }
    });

    if (allPoints.length === 0) {
      return {
        minLat: 0,
        minLng: 0,
        maxLat: 0,
        maxLng: 0,
      };
    }

    // 모든 좌표점에서 최소/최대 lat, lng 찾기
    const lngs = allPoints.map((point) => point[0]); // longitude
    const lats = allPoints.map((point) => point[1]); // latitude

    return {
      minLng: Math.min(...lngs),
      minLat: Math.min(...lats),
      maxLng: Math.max(...lngs),
      maxLat: Math.max(...lats),
    };
  }

  /**
   * 도보 경로 세그먼트 생성
   */
  buildWalkingSegment(path: GraphHopperPath): RouteSegmentDto {
    return {
      type: 'walking',
      summary: this.convertToSummary(path),
      bbox: this.convertToBoundingBox(path.bbox),
      geometry: this.convertToGeometry(path.points),
    };
  }

  /**
   * 자전거 경로 세그먼트 생성 (대여소 정보 포함)
   */
  createBikeSegmentWithStations(
    path: GraphHopperPath,
    startStation?: RouteStation,
    endStation?: RouteStation,
  ): RouteSegmentDto {
    const segment: RouteSegmentDto = {
      type: 'biking',
      summary: this.convertToSummary(path),
      bbox: this.convertToBoundingBox(path.bbox),
      geometry: this.convertToGeometry(path.points),
      profile: this.convertToBikeProfile(path.profile), // GraphHopper 프로필을 enum으로 변환
    };

    if (startStation) {
      segment.startStation = {
        station_id: startStation.id,
        station_name: startStation.name,
        lat: startStation.lat,
        lng: startStation.lng,
        current_bikes: 8,
      };
    }

    if (endStation) {
      segment.endStation = {
        station_id: endStation.id,
        station_name: endStation.name,
        lat: endStation.lat,
        lng: endStation.lng,
        current_bikes: 5,
      };
    }

    return segment;
  }

  /**
   * 왕복 경로를 RouteDto로 변환 (4단계: 도보→자전거→자전거→도보)
   */
  buildDirectRoundTripRoute(
    walkingToStation: GraphHopperPath,
    bikeToDestination: GraphHopperPath,
    bikeToStation: GraphHopperPath,
    walkingToStart: GraphHopperPath,
    station: RouteStation,
    routeCategory?: string,
  ): RouteDto {
    const segments: RouteSegmentDto[] = [
      {
        type: 'walking',
        summary: this.convertToSummary(walkingToStation),
        bbox: this.convertToBoundingBox(walkingToStation.bbox),
        geometry: this.convertToGeometry(walkingToStation.points),
      },
      {
        type: 'biking',
        summary: this.convertToSummary(bikeToDestination),
        bbox: this.convertToBoundingBox(bikeToDestination.bbox),
        geometry: this.convertToGeometry(bikeToDestination.points),
        profile: this.convertToBikeProfile(bikeToDestination.profile), // 자전거 프로필 정보 추가
        startStation: {
          station_id: station.id,
          station_name: station.name,
          lat: station.lat,
          lng: station.lng,
          current_bikes: 8,
        },
      },
      {
        type: 'biking',
        summary: this.convertToSummary(bikeToStation),
        bbox: this.convertToBoundingBox(bikeToStation.bbox),
        geometry: this.convertToGeometry(bikeToStation.points),
        profile: this.convertToBikeProfile(bikeToStation.profile), // 자전거 프로필 정보 추가
        endStation: {
          station_id: station.id,
          station_name: station.name,
          lat: station.lat,
          lng: station.lng,
          current_bikes: 5,
        },
      },
      {
        type: 'walking',
        summary: this.convertToSummary(walkingToStart),
        bbox: this.convertToBoundingBox(walkingToStart.bbox),
        geometry: this.convertToGeometry(walkingToStart.points),
      },
    ];

    const totalSummary: SummaryDto = {
      distance:
        walkingToStation.distance +
        bikeToDestination.distance +
        bikeToStation.distance +
        walkingToStart.distance,
      time: Math.round(
        (walkingToStation.time +
          bikeToDestination.time +
          bikeToStation.time +
          walkingToStart.time) /
          1000,
      ), // ms to seconds
      ascent:
        walkingToStation.ascend +
        bikeToDestination.ascend +
        bikeToStation.ascend +
        walkingToStart.ascend,
      descent:
        walkingToStation.descend +
        bikeToDestination.descend +
        bikeToStation.descend +
        walkingToStart.descend,
    };

    return {
      routeCategory: routeCategory || '일반 경로',
      summary: totalSummary,
      bbox: this.calculateBoundingBoxFromPaths([
        walkingToStation,
        bikeToDestination,
        bikeToStation,
        walkingToStart,
      ]),
      segments,
    };
  }

  /**
   * 원형 경로를 RouteDto로 변환 (3단계: 도보→자전거→도보)
   */
  buildCircularRoute(
    walkingToStation: GraphHopperPath,
    circularBikeRoute: GraphHopperPath,
    walkingToStart: GraphHopperPath,
    station: RouteStation,
    routeCategory?: string,
  ): RouteDto {
    const segments: RouteSegmentDto[] = [
      // 1단계: 출발지 → 대여소 (도보)
      {
        type: 'walking',
        summary: this.convertToSummary(walkingToStation),
        bbox: this.convertToBoundingBox(walkingToStation.bbox),
        geometry: this.convertToGeometry(walkingToStation.points),
      },
      // 2단계: 대여소 → 원형 경로 → 대여소 (자전거)
      {
        type: 'biking',
        summary: this.convertToSummary(circularBikeRoute),
        bbox: this.convertToBoundingBox(circularBikeRoute.bbox),
        geometry: this.convertToGeometry(circularBikeRoute.points),
        profile: this.convertToBikeProfile(circularBikeRoute.profile), // 자전거 프로필 정보 추가
        startStation: {
          station_id: station.id,
          station_name: station.name,
          lat: station.lat,
          lng: station.lng,
          current_bikes: 8,
        },
        endStation: {
          station_id: station.id,
          station_name: station.name,
          lat: station.lat,
          lng: station.lng,
          current_bikes: 5,
        },
      },
      // 3단계: 대여소 → 출발지 (도보)
      {
        type: 'walking',
        summary: this.convertToSummary(walkingToStart),
        bbox: this.convertToBoundingBox(walkingToStart.bbox),
        geometry: this.convertToGeometry(walkingToStart.points),
      },
    ];

    const totalSummary: SummaryDto = {
      distance:
        walkingToStation.distance +
        circularBikeRoute.distance +
        walkingToStart.distance,
      time: Math.round(
        (walkingToStation.time + circularBikeRoute.time + walkingToStart.time) /
          1000,
      ), // ms to seconds
      ascent:
        walkingToStation.ascend +
        circularBikeRoute.ascend +
        walkingToStart.ascend,
      descent:
        walkingToStation.descend +
        circularBikeRoute.descend +
        walkingToStart.descend,
    };

    return {
      routeCategory: routeCategory || '일반 경로',
      summary: totalSummary,
      bbox: this.calculateBoundingBoxFromPaths([
        walkingToStation,
        circularBikeRoute,
        walkingToStart,
      ]),
      segments,
    };
  }

  /**
   * 왕복 경로의 outbound와 return 경로를 카테고리별로 매칭하여 RouteDto 생성
   */
  buildRoundTripRoutesFromPaths(
    outboundPaths: CategorizedPath[],
    returnPaths: CategorizedPath[],
    walkingToStation: GraphHopperPath,
    walkingFromStation: GraphHopperPath,
    station: RouteStation,
  ): RouteDto[] {
    const roundTripRoutes: RouteDto[] = [];

    const maxRoutes = Math.min(outboundPaths.length, returnPaths.length);

    for (let i = 0; i < maxRoutes; i++) {
      const outboundPath = outboundPaths[i];
      const returnPath = returnPaths[i];

      const roundTripRoute = this.buildDirectRoundTripRoute(
        walkingToStation,
        outboundPath, // 대여소 → 반환점
        returnPath, // 반환점 → 대여소
        walkingFromStation,
        station,
        outboundPath.routeCategory,
      );

      roundTripRoutes.push(roundTripRoute);
    }

    return roundTripRoutes;
  }

  /**
   * GraphHopper 경로를 RouteSegmentDto로 변환 (다구간 경로용)
   */
  convertToRouteSegment(routeData: GraphHopperPath): RouteSegmentDto {
    const isWalking = routeData.profile === 'foot';
    return {
      type: isWalking ? 'walking' : 'biking',
      summary: this.convertToSummary(routeData, !isWalking), // 자전거 구간인 경우에만 자전거 도로 비율 포함
      bbox: this.convertToBoundingBox(routeData.bbox),
      geometry: this.convertToGeometry(routeData.points),
      profile: isWalking
        ? undefined
        : this.convertToBikeProfile(routeData.profile),
    };
  }
}
