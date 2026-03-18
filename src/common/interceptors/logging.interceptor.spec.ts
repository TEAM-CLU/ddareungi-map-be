import { ConfigService } from '@nestjs/config';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

describe('LoggingInterceptor', () => {
  const createConfigService = (values: Record<string, string | undefined>) =>
    ({
      get: jest.fn((key: string, defaultValue?: string) => {
        return values[key] ?? defaultValue;
      }),
    }) as unknown as ConfigService;

  const createContext = (params: {
    url: string;
    method?: string;
    statusCode?: number;
    headers?: Record<string, string | undefined>;
  }) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          url: params.url,
          method: params.method ?? 'GET',
          headers: params.headers ?? {},
        }),
        getResponse: () => ({
          statusCode: params.statusCode ?? 200,
          setHeader: jest.fn(),
        }),
      }),
    }) as ExecutionContext;

  const createCallHandler = (value: unknown): CallHandler => ({
    handle: () => of(value),
  });

  const createErrorCallHandler = (error: Error): CallHandler => ({
    handle: () => throwError(() => error),
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('skips logging for swagger and health routes', async () => {
    const interceptor = new LoggingInterceptor(createConfigService({}));
    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    Object.assign(interceptor as object, { logger });

    await lastValueFrom(
      interceptor.intercept(
        createContext({ url: '/api-docs' }),
        createCallHandler({ ok: true }),
      ),
    );
    await lastValueFrom(
      interceptor.intercept(
        createContext({ url: '/health' }),
        createCallHandler({ ok: true }),
      ),
    );

    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs slow production requests as warn', async () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2505);

    const interceptor = new LoggingInterceptor(
      createConfigService({ NODE_ENV: 'production' }),
    );
    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    Object.assign(interceptor as object, { logger });

    await lastValueFrom(
      interceptor.intercept(
        createContext({ url: '/stations' }),
        createCallHandler({ ok: true }),
      ),
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('logs production 4xx as warn and 5xx as error', async () => {
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1100)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(2100);

    const interceptor = new LoggingInterceptor(
      createConfigService({ NODE_ENV: 'production' }),
    );
    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    Object.assign(interceptor as object, { logger });

    await expect(
      lastValueFrom(
        interceptor.intercept(
          createContext({ url: '/auth/check-status', statusCode: 429 }),
          createErrorCallHandler(new Error('Too many requests')),
        ),
      ),
    ).rejects.toThrow('Too many requests');

    await expect(
      lastValueFrom(
        interceptor.intercept(
          createContext({ url: '/stations', statusCode: 500 }),
          createErrorCallHandler(new Error('Internal error')),
        ),
      ),
    ).rejects.toThrow('Internal error');

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
