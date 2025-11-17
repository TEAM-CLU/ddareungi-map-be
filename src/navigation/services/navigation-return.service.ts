import { Injectable, Logger } from '@nestjs/common';
import { CoordinateDto, RouteSegmentDto } from '../../routes/dto/route.dto';
import { GraphHopperService } from '../../routes/services/graphhopper.service';
import { ReturnToRouteResponseDto } from '../dto/navigation.dto';
import { NavigationHelperService } from './navigation-helper.service';
import { NavigationSessionService } from './navigation-session.service';

/**
 * 기존 경로로 복귀하는 서비스
 * - 책임: 이탈 시 원래 경로로 복귀하는 비즈니스 로직
 * - 권한: SessionService를 통한 세션 조회/업데이트, GraphHopper API 호출
 * - 특징: 다음 instruction까지의 짧은 경로만 추가, Redis에 경로 저장
 */
@Injectable()
export class NavigationReturnService {
  private readonly logger = new Logger(NavigationReturnService.name);

  constructor(
    private readonly helperService: NavigationHelperService,
    private readonly sessionService: NavigationSessionService,
    private readonly graphHopperService: GraphHopperService,
  ) {}

  /**
   * 기존 경로로 복귀
   * - 현재 위치에서 다음 instruction 지점까지의 경로 생성
   * - 복귀 경로와 남은 경로를 geometry 포함하여 통합
   * - Redis에 업데이트된 경로 저장
   */
  async returnToRoute(
    sessionId: string,
    currentLocation: CoordinateDto,
  ): Promise<ReturnToRouteResponseDto> {
    // 1. SessionService를 통해 세션 + 경로 데이터 조회
    const sessionWithRoute =
      await this.sessionService.getSessionWithRoute(sessionId);
    const originalRoute = sessionWithRoute.route;
    const routeId = sessionWithRoute.routeId;

    this.logger.debug(
      `[이탈 판단] 세션 정보: routeId=${routeId}, ` +
        `routeType=${originalRoute.routeType}, ` +
        `segments=${originalRoute.segments.length}개, ` +
        `현재 위치=(${currentLocation.lat}, ${currentLocation.lng})`,
    );

    // 원래 경로의 모든 세그먼트 정보 로깅
    originalRoute.segments.forEach((segment, idx) => {
      this.logger.debug(
        `[원래 경로] segment[${idx}]: type=${segment.type}, ` +
          `points=${segment.geometry?.points?.length || 0}개, ` +
          `instructions=${segment.instructions?.length || 0}개`,
      );
    });

    // 2. 현재 위치에서 가장 가까운 경로 지점 찾기
    const closestPoint = this.helperService.findClosestPointOnRoute(
      currentLocation,
      originalRoute,
    );

    if (!closestPoint) {
      throw new Error(
        '경로에서 복귀 지점을 찾을 수 없습니다. 새로 경로를 검색해주세요.',
      );
    }

    this.logger.log(
      `경로 복귀 시작: sessionId=${sessionId}, ` +
        `closestPoint: segment=${closestPoint.segmentIndex}, ` +
        `point=${closestPoint.pointIndex}, distance=${Math.round(closestPoint.distance)}m`,
    );

    this.logger.debug(
      `[가장 가까운 지점] ` +
        `coordinate=(${closestPoint.coordinate.lat}, ${closestPoint.coordinate.lng}), ` +
        `세그먼트 타입=${originalRoute.segments[closestPoint.segmentIndex]?.type}`,
    );

    // 3. 다음 instruction 지점 찾기
    const nextInstruction = this.helperService.findNextInstructionPoint(
      originalRoute,
      closestPoint.segmentIndex,
      closestPoint.pointIndex,
    );

    if (!nextInstruction) {
      throw new Error(
        '다음 안내 지점을 찾을 수 없습니다. 목적지에 거의 도착했을 수 있습니다.',
      );
    }

    this.logger.debug(
      `다음 instruction 발견: segment=${nextInstruction.segmentIndex}, ` +
        `type=${nextInstruction.segmentType}, ` +
        `coordinate=(${nextInstruction.coordinate.lat}, ${nextInstruction.coordinate.lng})`,
    );

    this.logger.debug(
      `[복귀 경로 검색] 현재 위치 → 다음 instruction 지점: ` +
        `(${currentLocation.lat}, ${currentLocation.lng}) → ` +
        `(${nextInstruction.coordinate.lat}, ${nextInstruction.coordinate.lng})`,
    );

    // 4. 이탈 직전 세그먼트 타입 확인 (가장 가까운 지점이 속한 세그먼트)
    const closestSegment = originalRoute.segments[closestPoint.segmentIndex];
    const closestSegmentType = closestSegment.type;

    this.logger.debug(
      `[이탈 직전 세그먼트] segment[${closestPoint.segmentIndex}]: type=${closestSegmentType}, profile=${closestSegment.profile || 'N/A'}`,
    );

    // 5. 이탈 직전 세그먼트 타입에 따라 복귀 경로의 profile 결정
    let profile: string;
    let returnSegmentType: 'walking' | 'biking';

    if (closestSegmentType === 'biking') {
      // 자전거 세그먼트에서 이탈한 경우
      profile = closestSegment.profile || 'safe_bike';
      returnSegmentType = 'biking';

      this.logger.debug(
        `[복귀 경로] 자전거 세그먼트에서 이탈 → profile: ${profile}`,
      );
    } else {
      // 도보 세그먼트에서 이탈한 경우
      profile = 'foot';
      returnSegmentType = 'walking';

      this.logger.debug(`[복귀 경로] 도보 세그먼트에서 이탈`);
    }

    this.logger.debug(
      `[복귀 경로] returnSegmentType=${returnSegmentType}${returnSegmentType === 'biking' ? `, profile=${profile}` : ''}`,
    );

    const ghPath = await this.graphHopperService.getSingleRoute(
      currentLocation,
      nextInstruction.coordinate,
      profile,
    );

    if (!ghPath || !ghPath.instructions || ghPath.instructions.length === 0) {
      this.logger.error('[복귀 경로] 경로를 찾을 수 없음');
      throw new Error('복귀 경로를 찾을 수 없습니다.');
    }

    this.logger.debug(
      `[복귀 경로] 검색 완료: instructions=${ghPath.instructions.length}개, ` +
        `distance=${Math.round(ghPath.distance)}m, ` +
        `duration=${Math.round(ghPath.time / 1000)}초`,
    );

    // 6. GraphHopper 응답을 RouteSegmentDto로 변환
    const returnSegmentRaw = this.helperService.convertGraphHopperPathToSegment(
      ghPath,
      returnSegmentType,
      returnSegmentType === 'biking'
        ? (profile as 'safe_bike' | 'fast_bike')
        : undefined,
    );

    // 복귀 경로의 마지막 instruction이 도착 instruction인 경우 제거 (남은 경로와 자연스럽게 이어지도록)
    let returnInstructions = returnSegmentRaw.instructions || [];
    if (
      returnInstructions.length > 0 &&
      (returnInstructions[returnInstructions.length - 1].text.includes(
        'Arrive at destination',
      ) ||
        returnInstructions[returnInstructions.length - 1].text.includes(
          'Arrive at waypoint',
        ) ||
        returnInstructions[returnInstructions.length - 1].text.includes(
          '목적지에 도착',
        ) ||
        returnInstructions[returnInstructions.length - 1].text.includes(
          '경유지에 도착',
        ))
    ) {
      this.logger.debug(
        `[복귀 경로] 마지막 instruction 제거 (도착 지점): "${returnInstructions[returnInstructions.length - 1].text}"`,
      );
      returnInstructions = returnInstructions.slice(0, -1);
    }

    // 필드 순서 보장: type → profile → summary → bbox → geometry → instructions
    const returnSegment: RouteSegmentDto = {
      type: returnSegmentRaw.type,
      ...(returnSegmentRaw.profile && { profile: returnSegmentRaw.profile }),
      summary: returnSegmentRaw.summary,
      bbox: returnSegmentRaw.bbox,
      geometry: returnSegmentRaw.geometry,
      ...(returnInstructions.length > 0 && {
        instructions: returnInstructions,
      }),
    };

    this.logger.debug(
      `[복귀 세그먼트] type=${returnSegment.type}, ` +
        `distance=${Math.round(returnSegment.summary.distance)}m, ` +
        `points=${returnSegment.geometry?.points.length || 0}개, ` +
        `instructions=${returnSegment.instructions?.length || 0}개`,
    );

    // 7. 원래 경로의 남은 부분 추출
    this.logger.debug(
      `[남은 경로 추출] 다음 instruction부터: ` +
        `segmentIndex=${nextInstruction.segmentIndex}, ` +
        `instructionIndex=${nextInstruction.instructionIndex}`,
    );

    const remainingSegments: RouteSegmentDto[] = [];

    // 다음 instruction이 속한 세그먼트부터 끝까지
    for (
      let i = nextInstruction.segmentIndex;
      i < originalRoute.segments.length;
      i++
    ) {
      const segment = originalRoute.segments[i];

      this.logger.debug(
        `[남은 경로] segment[${i}]: type=${segment.type}, ` +
          `points=${segment.geometry?.points?.length || 0}개, ` +
          `instructions=${segment.instructions?.length || 0}개`,
      );

      if (!segment.instructions || !segment.geometry) {
        this.logger.warn(
          `[남은 경로] segment[${i}]에 instructions 또는 geometry 없음`,
        );
        continue;
      }

      if (i === nextInstruction.segmentIndex) {
        // 다음 instruction 이후부터만 포함
        let remainingInstructions = segment.instructions.slice(
          nextInstruction.instructionIndex,
        );

        // 첫 번째 instruction이 도착 instruction인 경우 제거 (이미 지나간 지점)
        if (
          remainingInstructions.length > 0 &&
          (remainingInstructions[0].text.includes('Arrive at destination') ||
            remainingInstructions[0].text.includes('Arrive at waypoint') ||
            remainingInstructions[0].text.includes('목적지에 도착') ||
            remainingInstructions[0].text.includes('경유지에 도착'))
        ) {
          this.logger.debug(
            `[남은 경로] 첫 번째 instruction 제거 (도착 지점): "${remainingInstructions[0].text}"`,
          );
          remainingInstructions = remainingInstructions.slice(1);
        }

        this.logger.debug(
          `[남은 경로] segment[${i}] 부분 포함: ` +
            `전체 ${segment.instructions.length}개 중 ` +
            `index ${nextInstruction.instructionIndex}부터 → ${remainingInstructions.length}개`,
        );

        if (remainingInstructions.length > 0) {
          // geometry도 instruction의 interval에 맞춰 자르기
          const firstInstruction = remainingInstructions[0];
          const startPointIndex = firstInstruction.interval[0];
          const remainingPoints =
            segment.geometry.points.slice(startPointIndex);

          // interval 재조정 (startPointIndex만큼 빼기)
          const adjustedInstructions = remainingInstructions.map((inst) => ({
            ...inst,
            interval: [
              inst.interval[0] - startPointIndex,
              inst.interval[1] - startPointIndex,
            ] as [number, number],
          }));

          // summary도 비율에 맞춰 조정
          const remainingRatio =
            remainingPoints.length / segment.geometry.points.length;

          // 필드 순서 보장: type → profile → summary → bbox → geometry → instructions
          const remainingSegment: RouteSegmentDto = {
            type: segment.type,
            ...(segment.type === 'biking' &&
              segment.profile && { profile: segment.profile }),
            summary: {
              distance: segment.summary.distance * remainingRatio,
              time: segment.summary.time * remainingRatio,
              ascent: segment.summary.ascent * remainingRatio,
              descent: segment.summary.descent * remainingRatio,
            },
            bbox: segment.bbox,
            geometry: {
              points: remainingPoints,
            },
            instructions: adjustedInstructions,
          };

          remainingSegments.push(remainingSegment);
        }
      } else {
        // 그 이후 세그먼트는 전체 포함
        this.logger.debug(
          `[남은 경로] segment[${i}] 전체 포함: ${segment.instructions.length}개`,
        );

        remainingSegments.push(segment);
      }
    }

    this.logger.log(
      `경로 복귀: returnSegment=1개 (${returnSegmentType}), remainingSegments=${remainingSegments.length}개`,
    );

    // 8. 복귀 경로와 남은 경로 병합
    const mergedSegments = this.helperService.mergeSegments(
      [returnSegment],
      remainingSegments,
    );

    this.logger.debug(
      `[병합 완료] 총 ${mergedSegments.length}개 segments, ` +
        `총 ${mergedSegments.reduce((sum, seg) => sum + (seg.instructions?.length || 0), 0)}개 instructions`,
    );

    // 9. 세션 TTL 갱신
    // - Redis 경로 데이터는 유지 (업데이트하지 않음)
    // - 세션 TTL만 갱신하여 Heartbeat 누락에 대비
    await this.helperService.refreshSessionTTL(sessionId);

    // 10. 거리/시간 반올림 (미터, 초 단위)
    const normalizedSegments =
      this.helperService.normalizeSegments(mergedSegments);

    // 11. 좌표 통합 및 고도 제거 (클라이언트 응답용)
    const coordinates =
      this.helperService.extractCoordinatesFromSegments(normalizedSegments);

    // 12. 인스트럭션 통합 (클라이언트 응답용)
    const instructions =
      this.helperService.extractInstructionsFromSegments(normalizedSegments);

    // 13. TTS 생성 및 URL, 다음 회전 좌표 추가
    const instructionsWithTts = await this.helperService.addTtsToInstructions(
      instructions,
      coordinates,
    );

    // 14. 세그먼트에서 geometry와 instructions 제거 (클라이언트 응답용)
    const segmentsWithoutGeometryAndInstructions =
      this.helperService.removeGeometryAndInstructionsFromSegments(
        normalizedSegments,
      );

    // 15. 총합 계산
    const totalSummary =
      this.helperService.calculateTotalSummary(normalizedSegments);

    // 16. 경계 박스 계산
    const bbox = this.helperService.calculateBoundingBox(normalizedSegments);

    // 17. 대여소 정보 추출 (원래 경로에서)
    const stationInfo = this.helperService.extractStationInfo(originalRoute);

    this.logger.log(
      `경로 복귀 완료: sessionId=${sessionId}, ` +
        `segments=${normalizedSegments.length}개, ` +
        `coordinates=${coordinates.length}개, ` +
        `instructions=${instructionsWithTts.length}개, ` +
        `총 거리=${Math.round(totalSummary.distance)}m, ` +
        `총 시간=${Math.round(totalSummary.time)}초 (경로 데이터는 유지)`,
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
      startStation: stationInfo.startStation,
      endStation: stationInfo.endStation,
      waypoints: originalRoute.waypoints,
      coordinates,
      instructions: instructionsWithTts,
      segments: segmentsWithoutGeometryAndInstructions,
    };
  }
}
