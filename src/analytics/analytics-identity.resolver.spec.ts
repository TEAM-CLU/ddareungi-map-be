import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AnalyticsIdentityResolver } from './analytics-identity.resolver';
import type { AnalyticsRequest } from './analytics.types';

describe('AnalyticsIdentityResolver', () => {
  const verifyMock = jest.fn();
  const jwtService = {
    verify: verifyMock,
  } as unknown as JwtService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prefers X-GA-Client-Id over X-Anonymous-App-Id', () => {
    const resolver = new AnalyticsIdentityResolver(jwtService);

    const result = resolver.resolve(
      createRequest({
        'x-ga-client-id': 'ga-client',
        'x-anonymous-app-id': 'anon-client',
      }),
    );

    expect(result).toEqual({
      clientId: 'ga-client',
      authState: 'anonymous',
    });
  });

  it('falls back to X-Anonymous-App-Id', () => {
    const resolver = new AnalyticsIdentityResolver(jwtService);

    const result = resolver.resolve(
      createRequest({
        'x-anonymous-app-id': 'anon-client',
      }),
    );

    expect(result).toEqual({
      clientId: 'anon-client',
      authState: 'anonymous',
    });
  });

  it('creates an ephemeral client id when no headers exist', () => {
    const resolver = new AnalyticsIdentityResolver(jwtService);

    const result = resolver.resolve(createRequest());

    expect(result.clientId).toEqual(expect.any(String));
    expect(result.authState).toBe('anonymous');
  });

  it('extracts user id from a valid JWT', () => {
    verifyMock.mockReturnValue({ userId: 123 });
    const resolver = new AnalyticsIdentityResolver(jwtService);

    const result = resolver.resolve(
      createRequest({
        authorization: 'Bearer valid-token',
        'x-anonymous-app-id': 'anon-client',
      }),
    );

    expect(result).toEqual({
      clientId: 'anon-client',
      userId: '123',
      authState: 'authenticated',
    });
  });

  it('treats invalid JWT as anonymous without throwing', () => {
    verifyMock.mockImplementation(() => {
      throw new Error('invalid token');
    });
    const resolver = new AnalyticsIdentityResolver(jwtService);

    expect(() =>
      resolver.resolve(
        createRequest({
          authorization: 'Bearer invalid-token',
          'x-anonymous-app-id': 'anon-client',
        }),
      ),
    ).not.toThrow();
  });
});

function createRequest(headers: Record<string, string> = {}): AnalyticsRequest {
  return {
    headers,
  } as unknown as AnalyticsRequest;
}
