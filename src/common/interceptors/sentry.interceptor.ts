import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import type { Request } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import * as Sentry from '@sentry/nestjs';

function safeToString(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * 전역 Sentry 인터셉터 (에러 모니터링 전용)
 * - 모든 예외를 자동 포착하여 Sentry로 전송
 * - CLS의 traceId를 Sentry tag로 연동
 * - 요청 컨텍스트(method, url, ip 등) 수집
 *
 * 주의: production 환경 + SENTRY_DSN 설정된 경우에만 전송
 */
@Injectable()
export class SentryInterceptor implements NestInterceptor {
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly clsService: ClsService,
  ) {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'local');
    const dsn = this.configService.get<string>('SENTRY_DSN');
    this.enabled = nodeEnv === 'production' && !!dsn;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request | undefined>();
    const traceId = this.clsService.get<string>('traceId');

    return next.handle().pipe(
      catchError((err: unknown) => {
        Sentry.withScope((scope) => {
          if (traceId) scope.setTag('traceId', traceId);

          if (request) {
            const method = request.method;
            const url = request.originalUrl || request.url;
            const ip =
              (typeof request.headers['x-forwarded-for'] === 'string'
                ? request.headers['x-forwarded-for'].split(',')[0]?.trim()
                : undefined) || request.ip;

            scope.setTag('service', 'ddareungimap-backend');
            scope.setTag('method', method);
            scope.setTag('url', url);
            if (ip) scope.setTag('ip', ip);

            const user = (request as unknown as { user?: unknown }).user as
              | Record<string, unknown>
              | undefined;
            if (user) {
              const id =
                (user.id as string | number | undefined) ??
                (user.userId as string | number | undefined);
              const email = user.email as string | undefined;
              if (id !== undefined || email) {
                scope.setUser({
                  id: id !== undefined ? String(id) : undefined,
                  email,
                });
              }
            }
          }

          const error =
            err instanceof Error ? err : new Error(safeToString(err));
          Sentry.captureException(error);
        });

        return throwError(() => err);
      }),
    );
  }
}
