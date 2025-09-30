import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  FullJourneyRequestDto,
  BoundingBoxDto,
  RouteDto,
  RouteSegmentDto,
  BikeProfile,
  SummaryDto,
  GeometryDto,
  InstructionDto,
} from './dto/full-journey.dto';
import {
  RoundTripSearchRequestDto,
  RoundTripRecommendRequestDto,
  RoundTripResponseDto,
  RoundTripRouteDto,
} from './dto/round-trip.dto';
import {
  GraphHopperPath,
  GraphHopperResponse,
} from './interfaces/graphhopper.interface';

interface MockStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);
  private readonly graphHopperBaseUrl = 'http://localhost:8989';

  constructor(private readonly httpService: HttpService) {}

  /**
   * 전체 여정 경로 찾기 (도보 + 자전거 + 도보)
   */
  async findFullJourney(request: FullJourneyRequestDto): Promise<RouteDto[]> {
    try {
      const profile = request.profile || BikeProfile.SAFE_BIKE;

      // 임시 대여소 데이터 (대여소만 모킹)
      const mockStartStation = {
        id: '1',
        name: '가상 출발 대여소',
        lat: request.start.lat + 0.001,
        lng: request.start.lng + 0.001,
      };

      const mockEndStation = {
        id: '2',
        name: '가상 도착 대여소',
        lat: request.end.lat - 0.001,
        lng: request.end.lng - 0.001,
      };

      // GraphHopper API로 실제 경로 계산
      const [walkingToStart, bikeRoute, walkingFromEnd] = await Promise.all([
        // 1단계: 출발지에서 대여소까지 (도보)
        this.getRoute(request.start, mockStartStation, 'foot'),
        // 2단계: 대여소에서 대여소까지 (자전거)
        this.getRoute(mockStartStation, mockEndStation, profile as string),
        // 3단계: 대여소에서 목적지까지 (도보)
        this.getRoute(mockEndStation, request.end, 'foot'),
      ]);

      const route = this.buildRouteFromGraphHopper(
        profile,
        walkingToStart,
        bikeRoute,
        walkingFromEnd,
        mockStartStation,
        mockEndStation,
      );

      return [route];
    } catch (error) {
      this.logger.error('Full journey calculation failed', error);
      throw error;
    }
  }

  /**
   * 왕복 경로 검색 (A → B → A)
   * 시작지 → 근처대여소(도보) → 반환점(자전거) → 근처대여소(자전거) → 시작지(도보)
   */
  async findRoundTripSearch(
    request: RoundTripSearchRequestDto,
  ): Promise<RoundTripResponseDto> {
    try {
      const profile = request.profile || BikeProfile.SAFE_BIKE;

      // 시작지 근처 대여소 (모킹)
      const mockStartStation = {
        id: '1',
        name: '시작 대여소',
        lat: request.start.lat + 0.001,
        lng: request.start.lng + 0.001,
      };

      // GraphHopper API로 실제 경로 계산
      const [
        walkingToStation,
        bikeToDestination,
        bikeToStation,
        walkingToStart,
      ] = await Promise.all([
        // 1단계: 시작지에서 근처 대여소까지 (도보)
        this.getRoute(request.start, mockStartStation, 'foot'),
        // 2단계: 시작 대여소에서 반환점까지 (자전거)
        this.getRoute(mockStartStation, request.end, profile as string),
        // 3단계: 반환점에서 시작 대여소까지 (자전거)
        this.getRoute(request.end, mockStartStation, profile as string),
        // 4단계: 시작 대여소에서 시작점까지 (도보)
        this.getRoute(mockStartStation, request.start, 'foot'),
      ]);

      const routes: RoundTripRouteDto[] = [
        {
          type: 'walking',
          summary: this.convertToSummary(walkingToStation),
          bbox: this.convertToBoundingBox(walkingToStation.bbox),
          geometry: this.convertToGeometry(walkingToStation.points),
          instructions: this.convertToInstructions(
            walkingToStation.instructions,
          ),
        },
        {
          type: 'biking',
          summary: this.convertToSummary(bikeToDestination),
          bbox: this.convertToBoundingBox(bikeToDestination.bbox),
          geometry: this.convertToGeometry(bikeToDestination.points),
          instructions: this.convertToInstructions(
            bikeToDestination.instructions,
          ),
          startStation: {
            station_id: mockStartStation.id,
            station_name: mockStartStation.name,
            lat: mockStartStation.lat,
            lng: mockStartStation.lng,
            current_bikes: 8,
          },
        },
        {
          type: 'biking',
          summary: this.convertToSummary(bikeToStation),
          bbox: this.convertToBoundingBox(bikeToStation.bbox),
          geometry: this.convertToGeometry(bikeToStation.points),
          instructions: this.convertToInstructions(bikeToStation.instructions),
          endStation: {
            station_id: mockStartStation.id,
            station_name: mockStartStation.name,
            lat: mockStartStation.lat,
            lng: mockStartStation.lng,
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

      return {
        routes,
        processingTime: 150,
      };
    } catch (error) {
      this.logger.error('Round trip search failed', error);
      throw error;
    }
  }

  /**
   * 왕복 추천 경로 (원형 경로)
   * 출발지 → 근처대여소(도보) → 원형경로(자전거) → 근처대여소(도보) → 출발지
   */
  async findRoundTripRecommendations(
    request: RoundTripRecommendRequestDto,
  ): Promise<RoundTripResponseDto> {
    try {
      const profile = request.profile || BikeProfile.SAFE_BIKE;

      // 출발지 근처 대여소 (모킹)
      const mockStation = {
        id: '1',
        name: '원형 경로 대여소',
        lat: request.start.lat + 0.001,
        lng: request.start.lng + 0.001,
      };

      // GraphHopper API로 실제 경로 계산
      const [walkingToStation, roundTripRoute, walkingToStart] =
        await Promise.all([
          // 1단계: 출발지에서 근처 대여소까지 (도보)
          this.getRoute(request.start, mockStation, 'foot'),
          // 2단계: 대여소를 시작점으로 하는 원형 경로 (자전거 round_trip 알고리즘)
          this.getRoundTripRoute(
            mockStation,
            profile as string,
            request.targetDistance,
          ),
          // 3단계: 대여소에서 출발지까지 (도보)
          this.getRoute(mockStation, request.start, 'foot'),
        ]);

      const routes: RoundTripRouteDto[] = [
        {
          type: 'walking',
          summary: this.convertToSummary(walkingToStation),
          bbox: this.convertToBoundingBox(walkingToStation.bbox),
          geometry: this.convertToGeometry(walkingToStation.points),
          instructions: this.convertToInstructions(
            walkingToStation.instructions,
          ),
        },
        {
          type: 'biking',
          summary: this.convertToSummary(roundTripRoute),
          bbox: this.convertToBoundingBox(roundTripRoute.bbox),
          geometry: this.convertToGeometry(roundTripRoute.points),
          instructions: this.convertToInstructions(roundTripRoute.instructions),
          startStation: {
            station_id: mockStation.id,
            station_name: mockStation.name,
            lat: mockStation.lat,
            lng: mockStation.lng,
            current_bikes: 8,
          },
          endStation: {
            station_id: mockStation.id,
            station_name: mockStation.name,
            lat: mockStation.lat,
            lng: mockStation.lng,
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

      return {
        routes,
        processingTime: 200,
      };
    } catch (error) {
      this.logger.error('Round trip recommendations failed', error);
      throw error;
    }
  }

  /**
   * GraphHopper API 호출
   */
  private async getRoute(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    profile: string,
  ): Promise<GraphHopperPath> {
    const requestBody = {
      points: [
        [from.lng, from.lat], // GraphHopper는 [lng, lat] 순서
        [to.lng, to.lat],
      ],
      profile: profile,
      elevation: true,
      points_encoded: false,
      details: ['road_class'],
    };

    const response = await firstValueFrom(
      this.httpService.post<GraphHopperResponse>(
        `${this.graphHopperBaseUrl}/route`,
        requestBody,
      ),
    );

    return response.data.paths[0];
  }

  /**
   * Round Trip용 GraphHopper API 호출
   */
  private async getRoundTripRoute(
    start: { lat: number; lng: number },
    profile: string,
    targetDistance: number,
  ): Promise<GraphHopperPath> {
    const requestBody = {
      points: [[start.lng, start.lat]], // 시작점만 제공
      profile: profile,
      elevation: true,
      points_encoded: false,
      details: ['road_class'],
      algorithm: 'round_trip',
      'ch.disable': true,
      'round_trip.distance': targetDistance * 1000, // km to meters
      'round_trip.seed': Math.floor(Math.random() * 1000),
      'round_trip.points': 2,
    };

    const response = await firstValueFrom(
      this.httpService.post<GraphHopperResponse>(
        `${this.graphHopperBaseUrl}/route`,
        requestBody,
      ),
    );

    return response.data.paths[0];
  }

  /**
   * GraphHopper 경로에서 RouteDto 생성
   */
  private buildRouteFromGraphHopper(
    profile: BikeProfile,
    walkingToStart: GraphHopperPath,
    bikeRoute: GraphHopperPath,
    walkingFromEnd: GraphHopperPath,
    startStation: MockStation,
    endStation: MockStation,
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
      ascent: walkingToStart.ascent + bikeRoute.ascent + walkingFromEnd.ascent,
      descent:
        walkingToStart.descent + bikeRoute.descent + walkingFromEnd.descent,
    };

    return {
      profile,
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
   * 헬퍼 메서드들
   */
  private convertToSummary(path: GraphHopperPath): SummaryDto {
    return {
      distance: Math.round(path.distance),
      time: Math.round(path.time / 1000), // ms to seconds
      ascent: Math.round(path.ascent),
      descent: Math.round(path.descent),
    };
  }

  private convertToBoundingBox(
    bbox: [number, number, number, number],
  ): BoundingBoxDto {
    return {
      minLng: bbox[0],
      minLat: bbox[1],
      maxLng: bbox[2],
      maxLat: bbox[3],
    };
  }

  private convertToGeometry(points: { coordinates: number[][] }): GeometryDto {
    return {
      points: points.coordinates,
    };
  }

  private convertToInstructions(
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
      time: instruction.time,
      text: instruction.text,
      sign: instruction.sign,
      interval: instruction.interval,
    }));
  }

  private calculateOverallBoundingBox(
    bboxes: BoundingBoxDto[],
  ): BoundingBoxDto {
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
  private calculateBoundingBoxFromPaths(
    paths: GraphHopperPath[],
  ): BoundingBoxDto {
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
}
