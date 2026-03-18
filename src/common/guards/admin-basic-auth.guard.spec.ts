import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { AdminBasicAuthGuard } from './admin-basic-auth.guard';

describe('AdminBasicAuthGuard', () => {
  const createConfigService = (values: Record<string, string | undefined>) =>
    ({
      get: jest.fn((key: string) => values[key]),
    }) as unknown as ConfigService;

  const createExecutionContext = (authorization?: string) => {
    const setHeader = jest.fn();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization },
        }),
        getResponse: () => ({
          setHeader,
        }),
      }),
    } as ExecutionContext;

    return { context, setHeader };
  };

  it('allows access with valid basic auth credentials', () => {
    const guard = new AdminBasicAuthGuard(
      createConfigService({
        SWAGGER_ADMIN_USERNAME: 'admin',
        SWAGGER_ADMIN_PASSWORD: 'secret',
      }),
    );
    const { context, setHeader } = createExecutionContext(
      `Basic ${Buffer.from('admin:secret').toString('base64')}`,
    );

    expect(guard.canActivate(context)).toBe(true);
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('rejects access when credentials are missing', () => {
    const guard = new AdminBasicAuthGuard(createConfigService({}));
    const { context } = createExecutionContext();

    expect(() => guard.canActivate(context)).toThrow(NotFoundException);
  });

  it('rejects invalid credentials and sets challenge header', () => {
    const guard = new AdminBasicAuthGuard(
      createConfigService({
        SWAGGER_ADMIN_USERNAME: 'admin',
        SWAGGER_ADMIN_PASSWORD: 'secret',
      }),
    );
    const { context, setHeader } = createExecutionContext(
      `Basic ${Buffer.from('admin:wrong').toString('base64')}`,
    );

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Basic realm="Admin API"',
    );
  });
});
