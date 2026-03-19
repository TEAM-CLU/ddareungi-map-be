import { AnalyticsIdentityResolver } from '../analytics/analytics-identity.resolver';
import { AnalyticsService } from '../analytics/analytics.service';
import { NavigationController } from './navigation.controller';

describe('NavigationController', () => {
  const startNavigationSessionMock = jest.fn();
  const refreshSessionTTLMock = jest.fn();
  const returnToRouteMock = jest.fn();
  const fullRerouteMock = jest.fn();
  const endNavigationSessionMock = jest.fn();
  const trackEventMock = jest.fn();
  const resolveMock = jest.fn();

  const controller = new NavigationController(
    {
      startNavigationSession: startNavigationSessionMock,
      refreshSessionTTL: refreshSessionTTLMock,
    } as never,
    {
      returnToRoute: returnToRouteMock,
    } as never,
    {
      fullReroute: fullRerouteMock,
    } as never,
    {
      endNavigationSession: endNavigationSessionMock,
    } as never,
    {
      getSession: jest.fn(),
      getRoute: jest.fn(),
      getSessionWithRoute: jest.fn(),
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

  it('tracks navigation start success and api success', async () => {
    startNavigationSessionMock.mockResolvedValue({
      sessionId: 'session-1',
      coordinates: [],
      instructions: [{ text: '직진' }],
      segments: [],
      waypoints: [],
    });

    const response = await controller.startNavigation({ routeId: 'route-1' }, {
      headers: {},
    } as never);

    expect(response.message).toContain('성공적으로 시작');
    expect(trackEventMock).toHaveBeenCalledTimes(2);
    expect(trackEventMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: 'navigation_started',
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

  it('does not track heartbeat analytics', async () => {
    await controller.heartbeat('session-1');

    expect(refreshSessionTTLMock).toHaveBeenCalledWith('session-1');
    expect(trackEventMock).not.toHaveBeenCalled();
  });
});
