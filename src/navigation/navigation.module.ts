import { Module } from '@nestjs/common';
import { NavigationController } from './navigation.controller';
import { NavigationService } from './navigation.service';
import { NavigationSessionService } from './services/navigation-session.service';
import { NavigationHelperService } from './services/navigation-helper.service';
import { NavigationReturnService } from './services/navigation-return.service';
import { NavigationRerouteService } from './services/navigation-reroute.service';
import { NavigationEndService } from './services/navigation-end.service';
import { RoutesModule } from '../routes/routes.module';
import { TtsModule } from '../tts/tts.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [RoutesModule, TtsModule, AnalyticsModule],
  controllers: [NavigationController],
  providers: [
    // 핵심 서비스
    NavigationService,
    NavigationSessionService, // Redis 세션 CRUD 전담
    NavigationHelperService, // 유틸리티 함수 제공
    // 도메인 서비스
    NavigationReturnService,
    NavigationRerouteService,
    NavigationEndService,
  ],
  exports: [NavigationService, NavigationSessionService],
})
export class NavigationModule {}
