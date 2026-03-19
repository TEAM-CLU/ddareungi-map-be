import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AnalyticsService } from './analytics.service';
import { Ga4MeasurementProtocolClient } from './ga4-measurement-protocol.client';
import { AnalyticsIdentityResolver } from './analytics-identity.resolver';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'default-secret',
      }),
    }),
  ],
  providers: [
    AnalyticsService,
    Ga4MeasurementProtocolClient,
    AnalyticsIdentityResolver,
  ],
  exports: [AnalyticsService, AnalyticsIdentityResolver],
})
export class AnalyticsModule {}
