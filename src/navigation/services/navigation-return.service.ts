import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';
import {
  CoordinateDto,
  RouteSegmentDto,
  InstructionDto,
} from '../../routes/dto/route.dto';
import { GraphHopperService } from '../../routes/services/graphhopper.service';
import { NavigationRouteRedis } from '../dto/navigation-route-redis.interface';
import { ReturnToRouteResponseDto } from '../dto/navigation.dto';
import { NavigationHelperService } from './navigation-helper.service';

/**
 * 기존 경로로 복귀하는 서비스
 * - 이탈 시 다음 instruction까지의 짧은 경로만 추가
 * - Redis는 업데이트하지 않음 (원래 경로 유지)
 */
@Injectable()
export class NavigationReturnService {
  private readonly redis: Redis;
  private readonly logger = new Logger(NavigationReturnService.name);

  constructor(
    redisService: RedisService,
    private readonly graphHopperService: GraphHopperService,
    private readonly helperService: NavigationHelperService,
  ) {
    this.redis = redisService.getOrThrow();
  }

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
    // 1. 세션 조회
    const sessionKey = `navigation:session:${sessionId}`;
    const sessionJson = await this.redis.get(sessionKey);

    if (!sessionJson) {
      this.logger.error(`세션을 찾을 수 없습니다: ${sessionId}`);
      throw new Error('해당 세션이 존재하지 않습니다.');
    }

    const sessionData = JSON.parse(sessionJson) as {
      routeId: string;
      route: NavigationRouteRedis;
    };
    const originalRoute = sessionData.route;

    this.logger.debug(
      `[이탈 판단] 세션 정보: routeId=${sessionData.routeId}, ` +
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

    // 4. 현재 위치 → 다음 instruction 지점까지 복귀 경로 생성
    // 세그먼트 타입에 따라 이동 방식 결정
    let profile: string;

    if (nextInstruction.segmentType === 'biking') {
      // 자전거 세그먼트인 경우 원래 경로의 profile 참조
      const targetSegment =
        originalRoute.segments[nextInstruction.segmentIndex];
      profile = targetSegment?.profile || 'safe_bike'; // 기본값: safe_bike

      this.logger.debug(
        `[복귀 경로] 자전거 세그먼트 profile: ${profile} (segment[${nextInstruction.segmentIndex}])`,
      );
    } else {
      // 도보 세그먼트
      profile = 'foot';
    }

    this.logger.debug(
      `[복귀 경로] profile=${profile}, segmentType=${nextInstruction.segmentType}`,
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

    // 5. GraphHopper 응답을 RouteSegmentDto로 변환
    const returnSegment = this.helperService.convertGraphHopperPathToSegment(
      ghPath,
      nextInstruction.segmentType === 'biking' ? 'biking' : 'walking',
      nextInstruction.segmentType === 'biking'
        ? (profile as 'safe_bike' | 'fast_bike')
        : undefined,
    );

    this.logger.debug(
      `[복귀 세그먼트] type=${returnSegment.type}, ` +
        `distance=${Math.round(returnSegment.summary.distance)}m, ` +
        `points=${returnSegment.geometry.points.length}개, ` +
        `instructions=${returnSegment.instructions?.length || 0}개`,
    );

    // 6. 원래 경로의 남은 부분 추출
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
        const remainingInstructions = segment.instructions.slice(
          nextInstruction.instructionIndex,
        );

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

          remainingSegments.push({
            type: segment.type,
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
            profile: segment.profile,
            instructions: adjustedInstructions,
          });
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
      `경로 복귀: returnSegment=1개, remainingSegments=${remainingSegments.length}개`,
    );

    // 7. 복귀 경로와 남은 경로 병합
    const mergedSegments = this.helperService.mergeSegments(
      [returnSegment],
      remainingSegments,
    );

    this.logger.debug(
      `[병합 완료] 총 ${mergedSegments.length}개 segments, ` +
        `총 ${mergedSegments.reduce((sum, seg) => sum + (seg.instructions?.length || 0), 0)}개 instructions`,
    );

    // 8. 통합된 instructions 추출
    const allInstructions: InstructionDto[] = mergedSegments.flatMap(
      (seg) => seg.instructions || [],
    );

    // 9. 응답 반환 (Redis는 원래 경로 유지, 업데이트하지 않음)
    // - 프론트엔드가 원래 경로와 이탈 거리를 비교하여 Return/Reroute 판단
    // - Return은 임시 안내 경로만 제공, Reroute는 경로를 완전히 교체
    this.logger.log(
      `경로 복귀 완료: sessionId=${sessionId}, ` +
        `segments=${mergedSegments.length}개, instructions=${allInstructions.length}개 ` +
        `(Redis 원래 경로 유지)`,
    );

    return {
      sessionId,
      segments: mergedSegments,
      instructions: allInstructions,
    };
  }
}
