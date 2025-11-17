import { Injectable, Logger } from '@nestjs/common';
import { NavigationSessionDto } from './dto/navigation.dto';
import { InstructionDto } from '../routes/dto/route.dto';
import { NavigationHelperService } from './services/navigation-helper.service';
import { NavigationSessionService } from './services/navigation-session.service';

/**
 * 네비게이션 메인 서비스
 * - 책임: 네비게이션 세션 시작 및 TTL 관리 비즈니스 로직
 * - 권한: SessionService를 통한 세션 CRUD, HelperService를 통한 데이터 변환 및 TTS 처리
 */
@Injectable()
export class NavigationService {
  private readonly logger = new Logger(NavigationService.name);

  constructor(
    private readonly sessionService: NavigationSessionService,
    private readonly helperService: NavigationHelperService,
  ) {}

  /**
   * 네비게이션 세션 시작
   * - SessionService를 통해 경로 조회
   * - Instructions 추출 및 검증
   * - 새 세션 생성 (routeId 참조만 저장)
   *
   * @param routeId 경로 ID
   * @returns NavigationSessionDto (sessionId + instructions + segments)
   */
  async startNavigationSession(routeId: string): Promise<NavigationSessionDto> {
    // 1. SessionService를 통해 경로 데이터 조회
    const route = await this.sessionService.getRoute(routeId);

    // 2. segments 필드 검증
    if (!route.segments || !Array.isArray(route.segments)) {
      this.logger.error(
        `segments 필드 누락: routeId=${routeId}, hasSegments=${!!route.segments}`,
      );
      throw new Error(
        '경로 데이터에 segments 정보가 없습니다. 경로를 다시 검색해주세요.',
      );
    }

    // 3. Instructions 추출 및 통합 (interval 오프셋 자동 조정)
    const allInstructions: InstructionDto[] =
      this.helperService.extractInstructionsFromSegments(route.segments);

    if (allInstructions.length === 0) {
      this.logger.warn(
        `instructions가 있는 segment가 없습니다: ${routeId}, total segments: ${route.segments.length}`,
      );
      throw new Error(
        '경로에 네비게이션 정보가 포함되어 있지 않습니다. 경로를 다시 검색해주세요.',
      );
    }

    // 4. 좌표 통합 추출 (TTS 트리거 좌표 계산용)
    const coordinates = this.helperService.extractCoordinatesFromSegments(
      route.segments,
    );

    // 5. TTS 생성 및 URL, 다음 회전 좌표 추가
    const instructionsWithTts: InstructionDto[] =
      await this.helperService.addTtsToInstructions(
        allInstructions,
        coordinates,
      );

    // 6. SessionService를 통해 새 세션 생성 (routeId만 저장)
    const sessionId = await this.sessionService.createSession(routeId);

    // 7. 세그먼트에서 geometry와 instructions 제거 (클라이언트 응답용)
    const segmentsWithoutGeometryAndInstructions =
      this.helperService.removeGeometryAndInstructionsFromSegments(
        route.segments,
      );

    this.logger.log(
      `네비게이션 세션 생성: sessionId=${sessionId}, routeId=${routeId}, ` +
        `coordinates=${coordinates.length}개, ` +
        `instructions=${instructionsWithTts.length}개, ` +
        `waypoints=${route.waypoints?.length || 0}개`,
    );

    return {
      sessionId,
      coordinates,
      instructions: instructionsWithTts,
      waypoints: route.waypoints,
      segments: segmentsWithoutGeometryAndInstructions,
    };
  }

  /**
   * 네비게이션 세션 heartbeat (TTL 갱신)
   * - SessionService를 통해 세션 조회 및 TTL 갱신
   * - 세션과 경로 TTL을 함께 갱신
   *
   * @param sessionId 세션 ID
   * @throws 세션이 존재하지 않는 경우 에러 발생
   */
  async refreshSessionTTL(sessionId: string): Promise<void> {
    // 1. SessionService를 통해 세션 데이터 조회하여 routeId 획득
    const sessionData = await this.sessionService.getSession(sessionId);

    // 2. SessionService를 통해 세션 + 경로 TTL 동시 갱신
    await this.sessionService.refreshSessionTTL(sessionId, sessionData.routeId);

    this.logger.debug(
      `네비게이션 세션 및 경로 TTL 갱신: sessionId=${sessionId}, routeId=${sessionData.routeId}`,
    );
  }
}
