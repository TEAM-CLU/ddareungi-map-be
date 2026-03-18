import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  CoordinateDto,
  RouteSegmentDto,
  InstructionDto,
} from '../../routes/dto/route.dto';
import { NavigationRouteRedis } from '../dto/navigation-route-redis.interface';
import { FullRerouteResponseDto } from '../dto/navigation.dto';
import { NavigationHelperService } from './navigation-helper.service';
import { NavigationSessionService } from './navigation-session.service';
import { GraphHopperService } from '../../routes/services/graphhopper.service';
import { StationRouteService } from '../../routes/services/station-route.service';
import type { TravelMode } from '../dto/navigation.dto';

/**
 * 완전 재검색 서비스
 * - 책임: 경로 이탈 시 자전거 경로 재검색 비즈니스 로직
 * - 권한: SessionService를 통한 세션 조회/업데이트, GraphHopper API 호출
 * - 특징: 자전거 경로만 재검색 (현재 위치 → 경유지들 → 도착 대여소), 원본 도보 재사용
 */
@Injectable()
export class NavigationRerouteService {
  private readonly logger = new Logger(NavigationRerouteService.name);

  constructor(
    private readonly helperService: NavigationHelperService,
    private readonly sessionService: NavigationSessionService,
    private readonly graphHopperService: GraphHopperService,
    private readonly stationRouteService: StationRouteService,
  ) {}

  private rewriteLastArrivalInstruction(
    segment: RouteSegmentDto,
    newText: string,
  ): void {
    const instructions = segment.instructions;
    if (!instructions || instructions.length === 0) return;

    const last = instructions[instructions.length - 1];
    const looksLikeArrival =
      last.sign === 4 ||
      /Arrive at/i.test(last.text) ||
      last.text.includes('도착');

    if (looksLikeArrival) {
      last.text = newText;
    }
  }

  /**
   * 완전 재검색 (Full Reroute)
   * - 자전거 경로만 재검색: 현재 위치 → [남은 경유지들] → 도착 대여소
   * - 원본 경로의 마지막 도보 세그먼트 재사용 (도착 대여소 → 도착지)
   * - 출발 대여소는 원본 경로 유지 (변경 안 함)
   *
   * @param sessionId 네비게이션 세션 ID
   * @param currentLocation 현재 위치
   * @param remainingWaypoints 남은 경유지 배열 (프론트엔드에서 계산)
   * @returns 재검색된 경로 (geometry 포함)
   */
  async fullReroute(
    sessionId: string,
    currentLocation: CoordinateDto,
    remainingWaypoints?: CoordinateDto[],
    travelMode: TravelMode = 'biking',
  ): Promise<FullRerouteResponseDto> {
    // 1. SessionService를 통해 세션 + 경로 데이터 조회
    const sessionWithRoute =
      await this.sessionService.getSessionWithRoute(sessionId);
    const originalRoute = sessionWithRoute.route;
    const routeId = sessionWithRoute.routeId;

    // 2. circular 경로는 재검색 불가 (return-to-route만 사용)
    if (originalRoute.routeType === 'circular') {
      throw new BadRequestException({
        statusCode: 400,
        message:
          '원형 경로는 완전 재검색을 지원하지 않습니다. 기존 경로로 복귀(return) 기능을 사용해주세요.',
      });
    }

    // 3. 도착 대여소 정보 확인 (원본 경로의 endStation)
    const endStation = originalRoute.endStation;
    if (!endStation) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message:
          '원본 경로에 도착 대여소 정보가 없습니다. 재검색을 수행할 수 없습니다.',
      });
    }

    const endStationCoord: CoordinateDto = {
      lat: endStation.lat,
      lng: endStation.lng,
    };

    this.logger.log(
      `완전 재검색 시작: sessionId=${sessionId}, routeType=${originalRoute.routeType}, ` +
        `currentLocation=(${currentLocation.lat}, ${currentLocation.lng}), ` +
        `endStation=${endStation.name} (${endStationCoord.lat}, ${endStationCoord.lng}), ` +
        `remainingWaypoints=${remainingWaypoints?.length || 0}개, ` +
        `travelMode=${travelMode}`,
    );

    // 4. 원본 경로에서 마지막 도보 세그먼트 추출 (도착 대여소 → 도착지)
    const lastSegment =
      originalRoute.segments[originalRoute.segments.length - 1];
    if (!lastSegment || lastSegment.type !== 'walking') {
      throw new InternalServerErrorException({
        statusCode: 500,
        message:
          '원본 경로에 마지막 도보 세그먼트가 없습니다. 재검색을 수행할 수 없습니다.',
      });
    }

    const finalWalkingSegment = lastSegment;
    this.logger.debug(
      `기존 마지막 도보 세그먼트 재사용: distance=${Math.round(lastSegment.summary.distance)}m, ` +
        `time=${Math.round(lastSegment.summary.time)}초`,
    );

    // 5. 원본 경로의 자전거 프로필 추출 (이탈한 자전거 세그먼트의 프로필)
    const bikeProfile = this.extractBikeProfile(originalRoute.segments);
    if (!bikeProfile) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message:
          '원본 경로에 자전거 프로필 정보가 없습니다. 재검색을 수행할 수 없습니다.',
      });
    }

    this.logger.debug(`원본 경로의 자전거 프로필: ${bikeProfile}`);

    const waypointsForBike: CoordinateDto[] =
      remainingWaypoints && remainingWaypoints.length > 0
        ? remainingWaypoints
        : (originalRoute.waypoints ?? []);

    let startStationForRedis = originalRoute.startStation;
    let startStationForResponse = originalRoute.startStation;

    let finalSegments: RouteSegmentDto[] = [];

    if (travelMode === 'walking') {
      // walking: 현재 위치 근처 출발 대여소를 새로 탐색하고, 도보+자전거+도보 전체 재구성
      const startStation =
        await this.stationRouteService.findNearestAvailableStation({
          lat: currentLocation.lat,
          lng: currentLocation.lng,
        });

      if (!startStation) {
        throw new BadRequestException({
          statusCode: 400,
          message: `현재 위치 근처에 이용 가능한 출발 대여소를 찾을 수 없습니다. 좌표: ${currentLocation.lat}, ${currentLocation.lng}`,
        });
      }

      const startStationCoord: CoordinateDto = {
        lat: startStation.lat,
        lng: startStation.lng,
      };

      startStationForRedis = startStation;
      startStationForResponse = startStation;

      this.logger.debug(
        `출발 대여소 재탐색(walking): ${startStation.name} (${startStationCoord.lat}, ${startStationCoord.lng})`,
      );

      // 현재 위치 → 출발 대여소 (도보)
      const walkingToStartStationPath =
        await this.graphHopperService.getSingleRoute(
          { lat: currentLocation.lat, lng: currentLocation.lng },
          { lat: startStationCoord.lat, lng: startStationCoord.lng },
          'foot',
          true,
        );
      const walkingToStartStationSegment =
        this.helperService.convertGraphHopperPathToSegment(
          walkingToStartStationPath,
          'walking',
        );
      this.rewriteLastArrivalInstruction(
        walkingToStartStationSegment,
        'Arrive at start station',
      );

      // 출발 대여소 → [경유지들] → 도착 대여소 (자전거)
      this.logger.debug(
        `자전거 경로 재검색(walking): 출발 대여소 → [${waypointsForBike.length}개 경유지] → 도착 대여소`,
      );
      const bikeSegments = await this.searchBikeRouteWithWaypoints(
        startStationCoord,
        waypointsForBike,
        endStationCoord,
        bikeProfile,
      );
      this.logger.debug(
        `자전거 경로 재검색 완료(walking): ${bikeSegments.length}개 세그먼트`,
      );

      // 도보(현재→출발대여소) + 자전거 + 원본 마지막 도보(도착대여소→목적지) 통합
      finalSegments = [
        walkingToStartStationSegment,
        ...bikeSegments,
        finalWalkingSegment,
      ];
    } else {
      // biking: 기존 로직 유지 (현재 위치 → [남은 경유지들] → 도착 대여소) + 원본 마지막 도보 세그먼트
      this.logger.debug(
        `자전거 경로 재검색(biking): 현재 위치 → [${waypointsForBike.length}개 경유지] → 도착 대여소`,
      );
      const bikeSegments = await this.searchBikeRouteWithWaypoints(
        currentLocation,
        waypointsForBike,
        endStationCoord,
        bikeProfile,
      );
      this.logger.debug(
        `자전거 경로 재검색 완료(biking): ${bikeSegments.length}개 세그먼트`,
      );

      finalSegments = [...bikeSegments, finalWalkingSegment];
    }

    this.logger.debug(`최종 segments: ${finalSegments.length}개`);

    // 9. Instructions 추출
    const allInstructions: InstructionDto[] = finalSegments
      .filter((segment) => segment && segment.instructions)
      .flatMap((segment) => segment.instructions!);

    if (allInstructions.length === 0) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message:
          '재검색된 경로에 네비게이션 정보가 없습니다. 다시 시도해주세요.',
      });
    }

    this.logger.debug(`통합된 instructions: ${allInstructions.length}개`);

    // 10. Segments 검증 (geometry 포함 확인)
    const allSegments: RouteSegmentDto[] = finalSegments.filter(
      (segment) => segment && segment.geometry,
    );

    if (allSegments.length === 0) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: '재검색된 경로에 geometry 정보가 없습니다. 다시 시도해주세요.',
      });
    }

    this.logger.debug(
      `Segments: ${allSegments.length}개, ` +
        `총 geometry points: ${allSegments.reduce((sum, seg) => sum + (seg.geometry?.points.length || 0), 0)}개`,
    );

    // 11. 통합된 경로의 summary와 bbox 계산
    const normalizedSegments =
      this.helperService.normalizeSegments(allSegments);
    const totalSummary =
      this.helperService.calculateTotalSummary(normalizedSegments);
    const bbox = this.helperService.calculateBoundingBox(normalizedSegments);

    // 12. Redis 저장용 경로 생성 (원본 routeId 사용하여 덮어쓰기)
    if (!routeId) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: '원본 경로에 routeId가 없습니다.',
      });
    }

    const updatedRouteForRedis: NavigationRouteRedis = {
      routeId: routeId,
      routeCategory: originalRoute.routeCategory, // 원본 카테고리 유지
      summary: totalSummary,
      bbox,
      segments: allSegments, // instructions 포함된 통합 segments (네비게이션용)
      routeType: originalRoute.routeType,
      origin: originalRoute.origin,
      destination: originalRoute.destination,
      waypoints: waypointsForBike,
      targetDistance: originalRoute.targetDistance,
      startStation: startStationForRedis, // walking이면 현재 위치 기준으로 재탐색
      endStation: originalRoute.endStation, // 도착 대여소 유지
    };

    // 13. SessionService를 통해 경로 데이터 저장 (덮어쓰기)
    await this.sessionService.saveRoute(routeId, updatedRouteForRedis);

    // 14. SessionService를 통해 세션 TTL 갱신 (경로와 함께)
    await this.sessionService.refreshSessionTTL(sessionId, routeId);

    this.logger.log(
      `완전 재검색 완료: sessionId=${sessionId}, ` +
        `routeId=${routeId} (경로 덮어쓰기), ` +
        `segments=${allSegments.length}개, instructions=${allInstructions.length}개`,
    );

    // 15. 대여소 정보 추출 (원본 경로 유지)
    const startStationInfo = startStationForResponse
      ? {
          stationId: startStationForResponse.number,
          stationName: startStationForResponse.name,
          location: {
            lat: startStationForResponse.lat,
            lng: startStationForResponse.lng,
          },
        }
      : undefined;

    const endStationInfo = originalRoute.endStation
      ? {
          stationId: originalRoute.endStation.number,
          stationName: originalRoute.endStation.name,
          location: {
            lat: originalRoute.endStation.lat,
            lng: originalRoute.endStation.lng,
          },
        }
      : undefined;

    // 16. 좌표 통합 (클라이언트 응답용)
    const coordinates =
      this.helperService.extractCoordinatesFromSegments(normalizedSegments);

    // 17. 인스트럭션 통합 (클라이언트 응답용)
    const instructions =
      this.helperService.extractInstructionsFromSegments(normalizedSegments);

    // 18. TTS 생성 및 URL, 다음 회전 좌표 추가
    const instructionsWithTts = await this.helperService.addTtsToInstructions(
      instructions,
      coordinates,
    );

    // 19. 세그먼트에서 geometry와 instructions 제거 (클라이언트 응답용)
    const segmentsWithoutGeometryAndInstructions =
      this.helperService.removeGeometryAndInstructionsFromSegments(
        normalizedSegments,
      );

    this.logger.log(
      `클라이언트 응답 생성: coordinates=${coordinates.length}개, ` +
        `instructions=${instructionsWithTts.length}개, ` +
        `segments=${segmentsWithoutGeometryAndInstructions.length}개 (geometry, instructions 제외)`,
    );

    return {
      routeCategory: originalRoute.routeCategory,
      summary: {
        distance: Math.round(totalSummary.distance),
        time: Math.round(totalSummary.time),
        ascent: Math.round(totalSummary.ascent),
        descent: Math.round(totalSummary.descent),
      },
      bbox,
      startStation: startStationInfo,
      endStation: endStationInfo,
      waypoints: waypointsForBike,
      coordinates,
      instructions: instructionsWithTts,
      segments: segmentsWithoutGeometryAndInstructions,
    };
  }

  // ============================================================================
  // Private Methods - 자전거 경로 검색
  // ============================================================================

  /**
   * 원본 경로에서 자전거 프로필 추출
   * - 원본 경로의 자전거 세그먼트에서 사용된 프로필을 찾음
   *
   * @param segments 원본 경로의 세그먼트 배열
   * @returns 자전거 프로필 (safe_bike 또는 fast_bike)
   */
  private extractBikeProfile(
    segments: RouteSegmentDto[],
  ): 'safe_bike' | 'fast_bike' | null {
    // 자전거 세그먼트 찾기
    const bikeSegment = segments.find(
      (seg) => seg.type === 'biking' && seg.profile,
    );

    if (!bikeSegment || !bikeSegment.profile) {
      this.logger.warn('원본 경로에서 자전거 프로필을 찾을 수 없습니다.');
      return null;
    }

    return bikeSegment.profile;
  }

  /**
   * 경유지를 포함한 자전거 경로 검색
   * - 각 구간별로 GraphHopper API 호출
   * - 현재 위치 → 경유지1 → 경유지2 → ... → 도착 대여소
   *
   * @param start 현재 위치 (이탈 위치)
   * @param waypoints 남은 경유지들
   * @param end 도착 대여소
   * @param profile 자전거 프로필 (원본 경로에서 추출)
   * @returns 통합된 자전거 세그먼트 배열
   */
  private async searchBikeRouteWithWaypoints(
    start: CoordinateDto,
    waypoints: CoordinateDto[],
    end: CoordinateDto,
    profile: 'safe_bike' | 'fast_bike',
  ): Promise<RouteSegmentDto[]> {
    this.logger.debug(
      `자전거 경로 검색 시작: profile=${profile} (원본 경로에서 추출), 구간=${waypoints.length + 1}개`,
    );

    // 2. 경로 포인트 생성 (시작 → 경유지들 → 끝)
    const allPoints = [start, ...waypoints, end];
    const segments: RouteSegmentDto[] = [];

    // 3. 각 구간별로 경로 검색
    for (let i = 0; i < allPoints.length - 1; i++) {
      const from = allPoints[i];
      const to = allPoints[i + 1];

      this.logger.debug(
        `구간 ${i + 1}/${allPoints.length - 1} 검색: (${from.lat}, ${from.lng}) → (${to.lat}, ${to.lng})`,
      );

      try {
        // GraphHopper API로 자전거 경로 검색 (instructions 포함)
        const path = await this.graphHopperService.getSingleRoute(
          { lat: from.lat, lng: from.lng },
          { lat: to.lat, lng: to.lng },
          profile,
          true, // includeInstructions
        );

        // GraphHopper path를 RouteSegmentDto로 변환
        const segment = this.helperService.convertGraphHopperPathToSegment(
          path,
          'biking',
          profile,
        );

        // 종점 의미에 따라 도착 안내 치환
        // - 마지막 구간: 도착 대여소
        // - 중간 구간: 경유지
        const isLastLeg = i === allPoints.length - 2;
        this.rewriteLastArrivalInstruction(
          segment,
          isLastLeg ? 'Arrive at end station' : 'Arrive at waypoint',
        );

        segments.push(segment);

        this.logger.debug(
          `구간 ${i + 1} 검색 완료: distance=${Math.round(segment.summary.distance)}m, ` +
            `time=${Math.round(segment.summary.time)}초, ` +
            `instructions=${segment.instructions?.length || 0}개`,
        );
      } catch (error) {
        this.logger.error(
          `구간 ${i + 1} 검색 실패: (${from.lat}, ${from.lng}) → (${to.lat}, ${to.lng})`,
          error,
        );
        throw new BadRequestException({
          statusCode: 400,
          message: `자전거 경로 검색 실패: 구간 ${i + 1} (${from.lat}, ${from.lng}) → (${to.lat}, ${to.lng})`,
        });
      }
    }

    this.logger.log(
      `자전거 경로 검색 완료: 총 ${segments.length}개 구간, ` +
        `총 거리=${Math.round(segments.reduce((sum, s) => sum + s.summary.distance, 0))}m, ` +
        `총 시간=${Math.round(segments.reduce((sum, s) => sum + s.summary.time, 0))}초`,
    );

    return segments;
  }
}
