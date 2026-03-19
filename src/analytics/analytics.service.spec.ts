import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ga4MeasurementProtocolClient } from './ga4-measurement-protocol.client';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  const sendEventMock = jest.fn();
  const ga4Client = {
    sendEvent: sendEventMock,
  } as unknown as Ga4MeasurementProtocolClient;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    sendEventMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes undefined params before sending', async () => {
    const service = new AnalyticsService(
      createConfigService({
        GA4_MEASUREMENT_ID: 'G-TEST',
        GA4_API_SECRET: 'secret',
      }),
      ga4Client,
    );

    service.trackEvent({
      name: 'route_search_completed',
      identity: {
        clientId: 'client-id',
        authState: 'anonymous',
      },
      params: {
        route_search_type: 'full_journey',
        optional_value: undefined,
      },
    });

    await flushPromises();

    expect(sendEventMock).toHaveBeenCalledWith({
      name: 'route_search_completed',
      identity: {
        clientId: 'client-id',
        authState: 'anonymous',
      },
      params: {
        route_search_type: 'full_journey',
      },
    });
  });

  it('is a no-op when analytics is disabled', () => {
    const service = new AnalyticsService(createConfigService({}), ga4Client);

    service.trackEvent({
      name: 'station_search',
      identity: {
        clientId: 'client-id',
        authState: 'anonymous',
      },
    });

    expect(sendEventMock).not.toHaveBeenCalled();
  });

  it('swallows transport failures', async () => {
    sendEventMock.mockRejectedValue(new Error('network error'));
    const service = new AnalyticsService(
      createConfigService({
        GA4_MEASUREMENT_ID: 'G-TEST',
        GA4_API_SECRET: 'secret',
      }),
      ga4Client,
    );

    expect(() =>
      service.trackEvent({
        name: 'navigation_started',
        identity: {
          clientId: 'client-id',
          authState: 'anonymous',
        },
      }),
    ).not.toThrow();

    await flushPromises();
  });
});

function createConfigService(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
