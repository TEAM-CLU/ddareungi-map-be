import { Injectable, Logger } from '@nestjs/common';
import { NavigationSessionService } from './navigation-session.service';

/**
 * 네비게이션 세션 종료 서비스
 * - 책임: 네비게이션 세션 종료 비즈니스 로직
 * - 권한: NavigationSessionService를 통한 세션 삭제
 */
@Injectable()
export class NavigationEndService {
  private readonly logger = new Logger(NavigationEndService.name);

  constructor(private readonly sessionService: NavigationSessionService) {}

  /**
   * 네비게이션 세션 종료
   * @param sessionId 세션 ID
   * @throws Error 세션을 찾을 수 없거나 삭제에 실패한 경우
   */
  async endNavigationSession(sessionId: string): Promise<void> {
    this.logger.log(`세션 종료 시작: ${sessionId}`);

    // SessionService를 통해 세션 삭제 (세션 + 경로)
    const routeId = await this.sessionService.deleteSession(sessionId);

    this.logger.log(`세션 종료 완료: ${sessionId}, routeId: ${routeId}`);
  }
}
