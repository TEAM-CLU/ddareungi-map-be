import { BadRequestException } from '@nestjs/common';
import { AnalyticsIdentityResolver } from '../analytics/analytics-identity.resolver';
import { AnalyticsService } from '../analytics/analytics.service';
import { RoutesController } from './routes.controller';

describe('RoutesController', () => {
  const findFullJourneyMock = jest.fn();
  const findRoundTripRecommendationsMock = jest.fn();
  const trackEventMock = jest.fn();
  const resolveMock = jest.fn();

  const controller = new RoutesController(
    {
      findFullJourney: findFullJourneyMock,
      findRoundTripRecommendations: findRoundTripRecommendationsMock,
    } as never,
    {
      trackEvent: trackEventMock,
    } as unknown as AnalyticsService,
    {
      resolve: resolveMock,
    } as unknown as AnalyticsIdentityResolver,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    resolveMock.mockReturnValue({
      clientId: 'anon-client',
      authState: 'anonymous',
    });
  });

  it('tracks route search success and api success', async () => {
    findFullJourneyMock.mockResolvedValue([{ routeId: 'route-1' }]);

    const response = await controller.getFullJourney(
      {
        start: { lat: 37.5, lng: 127.0 },
        end: { lat: 37.6, lng: 127.1 },
      },
      { headers: {} } as never,
    );

    expect(response.message).toContain('성공적으로 검색');
    expect(trackEventMock).toHaveBeenCalledTimes(2);
    expect(trackEventMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: 'route_search_completed',
      }),
    );
    expect(trackEventMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: 'api_operation_result',
        params: expect.objectContaining({
          outcome: 'success',
        }),
      }),
    );
  });

  it('tracks api error and rethrows', async () => {
    findFullJourneyMock.mockRejectedValue(new BadRequestException('invalid'));

    await expect(
      controller.getFullJourney(
        {
          start: { lat: 37.5, lng: 127.0 },
          end: { lat: 37.6, lng: 127.1 },
        },
        { headers: {} } as never,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'api_operation_result',
        params: expect.objectContaining({
          outcome: 'error',
          http_status: 400,
          error_type: 'BadRequestException',
        }),
      }),
    );
  });
});
