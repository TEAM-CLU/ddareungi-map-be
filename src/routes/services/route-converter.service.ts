import { Injectable } from '@nestjs/common';
import {
  RouteDto,
  RouteSegmentDto,
  SummaryDto,
  BoundingBoxDto,
  GeometryDto,
  InstructionDto,
} from '../dto/full-journey.dto';
import { RoundTripRouteDto } from '../dto/round-trip.dto';
import { GraphHopperPath } from '../interfaces/graphhopper.interface';
import { CategorizedPath } from './route-optimizer.service';
import { MockStation } from './station-mock.service';

@Injectable()
export class RouteConverterService {
  /**
   * GraphHopper 경로에서 RouteDto 생성
   */
  buildRouteFromGraphHopper(
    walkingToStart: GraphHopperPath,
    bikeRoute: GraphHopperPath,
    walkingFromEnd: GraphHopperPath,
    startStation: MockStation,
    endStation: MockStation,
    routeCategory?: string, // 옵셔널 카테고리 정보
  ): RouteDto {
    const segments: RouteSegmentDto[] = [
      {
        type: 'walking',
        summary: this.convertToSummary(walkingToStart),
        bbox: this.convertToBoundingBox(walkingToStart.bbox),
        geometry: this.convertToGeometry(walkingToStart.points),
        instructions: this.convertToInstructions(walkingToStart.instructions),
      },
      {
        type: 'biking',
        summary: this.convertToSummary(bikeRoute),
        bbox: this.convertToBoundingBox(bikeRoute.bbox),
        geometry: this.convertToGeometry(bikeRoute.points),
        instructions: this.convertToInstructions(bikeRoute.instructions),
        profile: bikeRoute.profile, // 자전거 프로필 정보 추가
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
        instructions: this.convertToInstructions(walkingFromEnd.instructions),
      },
    ];

    const totalSummary: SummaryDto = {
      distance:
        walkingToStart.distance + bikeRoute.distance + walkingFromEnd.distance,
      time: Math.round(
        (walkingToStart.time + bikeRoute.time + walkingFromEnd.time) / 1000,
      ), // ms to seconds
      ascent: walkingToStart.ascend + bikeRoute.ascend + walkingFromEnd.ascend,
      descent:
        walkingToStart.descend + bikeRoute.descend + walkingFromEnd.descend,
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
   * GraphHopper Path를 SummaryDto로 변환
   */
  convertToSummary(path: GraphHopperPath): SummaryDto {
    return {
      distance: Math.round(path.distance),
      time: Math.round(path.time / 1000), // ms to seconds
      ascent: Math.round(path.ascend),
      descent: Math.round(path.descend),
    };
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
   * GraphHopper instructions를 InstructionDto로 변환
   */
  convertToInstructions(
    instructions: {
      distance: number;
      time: number;
      text: string;
      sign: number;
      interval: [number, number];
    }[],
  ): InstructionDto[] {
    return instructions.map((instruction) => ({
      distance: Math.round(instruction.distance),
      time: Math.round(instruction.time / 1000),
      text: instruction.text,
      sign: instruction.sign,
      interval: instruction.interval,
    }));
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
  buildWalkingSegment(path: GraphHopperPath): RoundTripRouteDto {
    return {
      type: 'walking',
      summary: this.convertToSummary(path),
      bbox: this.convertToBoundingBox(path.bbox),
      geometry: this.convertToGeometry(path.points),
      instructions: this.convertToInstructions(path.instructions),
    };
  }

  /**
   * 자전거 경로 세그먼트 생성 (대여소 정보 포함)
   */
  buildBikingSegment(
    path: GraphHopperPath,
    startStation?: MockStation,
    endStation?: MockStation,
  ): RoundTripRouteDto {
    const segment: RoundTripRouteDto = {
      type: 'biking',
      summary: this.convertToSummary(path),
      bbox: this.convertToBoundingBox(path.bbox),
      geometry: this.convertToGeometry(path.points),
      instructions: this.convertToInstructions(path.instructions),
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
  buildRoundTripRoute(
    walkingToStation: GraphHopperPath,
    bikeToDestination: GraphHopperPath,
    bikeToStation: GraphHopperPath,
    walkingToStart: GraphHopperPath,
    station: MockStation,
    routeCategory?: string,
  ): RouteDto {
    const segments: RouteSegmentDto[] = [
      {
        type: 'walking',
        summary: this.convertToSummary(walkingToStation),
        bbox: this.convertToBoundingBox(walkingToStation.bbox),
        geometry: this.convertToGeometry(walkingToStation.points),
        instructions: this.convertToInstructions(walkingToStation.instructions),
      },
      {
        type: 'biking',
        summary: this.convertToSummary(bikeToDestination),
        bbox: this.convertToBoundingBox(bikeToDestination.bbox),
        geometry: this.convertToGeometry(bikeToDestination.points),
        instructions: this.convertToInstructions(
          bikeToDestination.instructions,
        ),
        profile: bikeToDestination.profile, // 자전거 프로필 정보 추가
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
        instructions: this.convertToInstructions(bikeToStation.instructions),
        profile: bikeToStation.profile, // 자전거 프로필 정보 추가
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
        instructions: this.convertToInstructions(walkingToStart.instructions),
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
    station: MockStation,
    routeCategory?: string,
  ): RouteDto {
    const segments: RouteSegmentDto[] = [
      // 1단계: 출발지 → 대여소 (도보)
      {
        type: 'walking',
        summary: this.convertToSummary(walkingToStation),
        bbox: this.convertToBoundingBox(walkingToStation.bbox),
        geometry: this.convertToGeometry(walkingToStation.points),
        instructions: this.convertToInstructions(walkingToStation.instructions),
      },
      // 2단계: 대여소 → 원형 경로 → 대여소 (자전거)
      {
        type: 'biking',
        summary: this.convertToSummary(circularBikeRoute),
        bbox: this.convertToBoundingBox(circularBikeRoute.bbox),
        geometry: this.convertToGeometry(circularBikeRoute.points),
        instructions: this.convertToInstructions(
          circularBikeRoute.instructions,
        ),
        profile: circularBikeRoute.profile, // 자전거 프로필 정보 추가
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
        instructions: this.convertToInstructions(walkingToStart.instructions),
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
    station: MockStation,
  ): RouteDto[] {
    const roundTripRoutes: RouteDto[] = [];

    const maxRoutes = Math.min(outboundPaths.length, returnPaths.length);

    for (let i = 0; i < maxRoutes; i++) {
      const outboundPath = outboundPaths[i];
      const returnPath = returnPaths[i];

      const roundTripRoute = this.buildRoundTripRoute(
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
}
