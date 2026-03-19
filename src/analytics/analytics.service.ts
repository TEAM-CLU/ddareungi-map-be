import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ga4MeasurementProtocolClient } from './ga4-measurement-protocol.client';
import type { TrackEventInput } from './analytics.types';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly enabled: boolean;
  private hasLoggedDisabledWarning = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly ga4Client: Ga4MeasurementProtocolClient,
  ) {
    const measurementId = this.configService
      .get<string>('GA4_MEASUREMENT_ID')
      ?.trim();
    const apiSecret = this.configService.get<string>('GA4_API_SECRET')?.trim();
    this.enabled = Boolean(measurementId && apiSecret);
  }

  trackEvent(input: TrackEventInput): void {
    if (!this.enabled) {
      this.logDisabledWarningOnce();
      return;
    }

    const sanitizedParams = this.removeUndefinedParams(input.params);

    void this.ga4Client
      .sendEvent({
        ...input,
        ...(sanitizedParams ? { params: sanitizedParams } : undefined),
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `GA4 이벤트 전송 실패: event=${input.name}, message=${error instanceof Error ? error.message : 'unknown error'}`,
        );
      });
  }

  private removeUndefinedParams(
    params?: Record<string, string | number | boolean | null | undefined>,
  ): Record<string, string | number | boolean> | undefined {
    if (!params) {
      return undefined;
    }

    const sanitized = Object.fromEntries(
      Object.entries(params).filter(
        (entry): entry is [string, string | number | boolean] =>
          entry[1] !== undefined && entry[1] !== null,
      ),
    );

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }

  private logDisabledWarningOnce(): void {
    if (this.hasLoggedDisabledWarning) {
      return;
    }

    this.logger.warn(
      'GA4 analytics가 비활성화되었습니다. GA4_MEASUREMENT_ID 또는 GA4_API_SECRET 설정을 확인해주세요.',
    );
    this.hasLoggedDisabledWarning = true;
  }
}
