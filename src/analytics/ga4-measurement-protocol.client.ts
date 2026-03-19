import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GA4_MEASUREMENT_PROTOCOL_URL } from './analytics.constants';
import type { TrackEventInput } from './analytics.types';

@Injectable()
export class Ga4MeasurementProtocolClient {
  private readonly measurementId?: string;
  private readonly apiSecret?: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.measurementId = this.configService.get<string>('GA4_MEASUREMENT_ID');
    this.apiSecret = this.configService.get<string>('GA4_API_SECRET');
  }

  async sendEvent(input: TrackEventInput): Promise<void> {
    await this.httpService.axiosRef.post(
      GA4_MEASUREMENT_PROTOCOL_URL,
      {
        client_id: input.identity.clientId,
        ...(input.identity.userId
          ? { user_id: input.identity.userId }
          : undefined),
        events: [
          {
            name: input.name,
            params: input.params ?? {},
          },
        ],
      },
      {
        params: {
          measurement_id: this.measurementId,
          api_secret: this.apiSecret,
        },
      },
    );
  }
}
