import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { StationSyncService } from './station-sync.service';
import { SyncType } from '../entities/sync-log.entity';

/**
 * 메인 스테이션 서비스 - 애플리케이션 생명주기 관리만 담당
 * 각 기능별 서비스는 컨트롤러에서 직접 주입받아 사용
 */
@Injectable()
export class StationsService implements OnModuleInit {
  private readonly logger = new Logger(StationsService.name);

  constructor(private readonly stationSyncService: StationSyncService) {}

  /**
   * 서버 시작 시 동기화 필요 여부 확인 및 실행
   */
  async onModuleInit() {
    try {
      const needsSync = await this.stationSyncService.checkIfSyncNeeded();

      if (needsSync) {
        const result = await this.stationSyncService.performSync(
          SyncType.STARTUP_CHECK,
        );
        this.logger.log(
          `서버 시작 동기화 완료: 생성 ${result.created}개, 업데이트 ${result.updated}개`,
        );
      } else {
        this.logger.log('서버 시작: 최근 동기화 완료 상태 - 스킵');
      }
    } catch (error) {
      this.logger.error('서버 시작 동기화 실패:', error);
    }
  }
}
