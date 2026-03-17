import { ConfigService } from '@nestjs/config';
import { buildSwaggerBasicAuthMiddleware, isSwaggerEnabled } from './swagger-basic-auth.util';

describe('swagger-basic-auth.util', () => {
  const createConfigService = (values: Record<string, string | undefined>) =>
    ({
      get: jest.fn((key: string) => values[key]),
    }) as unknown as ConfigService;

  it('returns true only when both swagger credentials are set', () => {
    expect(
      isSwaggerEnabled(
        createConfigService({
          SWAGGER_ADMIN_USERNAME: 'admin',
          SWAGGER_ADMIN_PASSWORD: 'secret',
        }),
      ),
    ).toBe(true);

    expect(
      isSwaggerEnabled(
        createConfigService({
          SWAGGER_ADMIN_USERNAME: 'admin',
        }),
      ),
    ).toBe(false);

    expect(isSwaggerEnabled(createConfigService({}))).toBe(false);
  });

  it('rejects requests without basic auth credentials', () => {
    const middleware = buildSwaggerBasicAuthMiddleware(
      createConfigService({
        SWAGGER_ADMIN_USERNAME: 'admin',
        SWAGGER_ADMIN_PASSWORD: 'secret',
      }),
    );
    const setHeader = jest.fn();
    const status = jest.fn(() => ({ send: sendMock }));
    const sendMock = jest.fn();
    const next = jest.fn();

    middleware(
      {
        headers: {},
      } as never,
      {
        setHeader,
        status,
      } as never,
      next,
    );

    expect(setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Basic realm="Swagger Admin"',
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(sendMock).toHaveBeenCalledWith('Authentication required.');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with invalid basic auth credentials', () => {
    const middleware = buildSwaggerBasicAuthMiddleware(
      createConfigService({
        SWAGGER_ADMIN_USERNAME: 'admin',
        SWAGGER_ADMIN_PASSWORD: 'secret',
      }),
    );
    const setHeader = jest.fn();
    const status = jest.fn(() => ({ send: sendMock }));
    const sendMock = jest.fn();
    const next = jest.fn();

    middleware(
      {
        headers: {
          authorization: `Basic ${Buffer.from('admin:wrong').toString('base64')}`,
        },
      } as never,
      {
        setHeader,
        status,
      } as never,
      next,
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows requests with valid basic auth credentials', () => {
    const middleware = buildSwaggerBasicAuthMiddleware(
      createConfigService({
        SWAGGER_ADMIN_USERNAME: 'admin',
        SWAGGER_ADMIN_PASSWORD: 'secret',
      }),
    );
    const setHeader = jest.fn();
    const status = jest.fn();
    const next = jest.fn();

    middleware(
      {
        headers: {
          authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}`,
        },
      } as never,
      {
        setHeader,
        status,
      } as never,
      next,
    );

    expect(next).toHaveBeenCalled();
    expect(setHeader).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });
});
