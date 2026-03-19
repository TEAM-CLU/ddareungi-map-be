import { StationsController } from './stations.controller';
import { AnalyticsIdentityResolver } from '../analytics/analytics-identity.resolver';
import { AnalyticsService } from '../analytics/analytics.service';

describe('StationsController', () => {
  const validateCoordinatesMock = jest.fn();
  const getNearbyStationsMock = jest.fn();
  const trackEventMock = jest.fn();
  const resolveMock = jest.fn();

  const controller = new StationsController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      validateCoordinates: validateCoordinatesMock,
      validateCoordinatesWithRadius: jest.fn(),
      validateOptionalCoordinates: jest.fn(),
    } as never,
    {
      getNearbyStations: getNearbyStationsMock,
      getStationsWithinRadius: jest.fn(),
      getAllStations: jest.fn(),
      getStationDetail: jest.fn(),
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

  it('tracks station search success and api success', async () => {
    validateCoordinatesMock.mockReturnValue({
      latitude: 37.5,
      longitude: 127.0,
    });
    getNearbyStationsMock.mockResolvedValue({
      message: 'ok',
      data: [{ id: '1' }, { id: '2' }],
    });

    const response = await controller.getNearbyStations(37.5, 127.0, 'json', {
      headers: {},
    } as never);

    expect(response.message).toBe('ok');
    expect(trackEventMock).toHaveBeenCalledTimes(2);
    expect(trackEventMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: 'station_search',
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
});
