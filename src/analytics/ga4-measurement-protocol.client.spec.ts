import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Ga4MeasurementProtocolClient } from './ga4-measurement-protocol.client';

describe('Ga4MeasurementProtocolClient', () => {
  it('sends the expected GA4 Measurement Protocol payload', async () => {
    const postMock = jest.fn().mockResolvedValue({ status: 204 });
    const httpService = {
      axiosRef: {
        post: postMock,
      },
    } as unknown as HttpService;
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'GA4_MEASUREMENT_ID') {
          return 'G-TEST';
        }
        if (key === 'GA4_API_SECRET') {
          return 'secret';
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    const client = new Ga4MeasurementProtocolClient(httpService, configService);
    await client.sendEvent({
      name: 'route_search_completed',
      identity: {
        clientId: 'client-id',
        userId: '42',
        authState: 'authenticated',
      },
      params: {
        route_search_type: 'full_journey',
      },
    });

    expect(postMock).toHaveBeenCalledWith(
      'https://www.google-analytics.com/mp/collect',
      {
        client_id: 'client-id',
        user_id: '42',
        events: [
          {
            name: 'route_search_completed',
            params: {
              route_search_type: 'full_journey',
            },
          },
        ],
      },
      {
        params: {
          measurement_id: 'G-TEST',
          api_secret: 'secret',
        },
      },
    );
  });
});
