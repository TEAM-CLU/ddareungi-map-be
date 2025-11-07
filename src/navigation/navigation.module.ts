import { Module } from '@nestjs/common';
import { NavigationController } from './navigation.controller';
import { NavigationService } from './navigation.service';
import { NavigationHelperService } from './services/navigation-helper.service';
import { NavigationReturnService } from './services/navigation-return.service';
import { NavigationRerouteService } from './services/navigation-reroute.service';
import { NavigationEndService } from './services/navigation-end.service';
import { RoutesModule } from '../routes/routes.module';

@Module({
  imports: [RoutesModule],
  controllers: [NavigationController],
  providers: [
    NavigationService,
    NavigationHelperService,
    NavigationReturnService,
    NavigationRerouteService,
    NavigationEndService,
  ],
  exports: [NavigationService],
})
export class NavigationModule {}
