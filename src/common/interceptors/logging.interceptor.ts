import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

interface ClsService {
  set(key: string, value: unknown): void;
  get<T = unknown>(key: string): T | undefined;
}

/**
 * HTTP 요청/응답 로깅을 위한 인터셉터
 * - Trace ID 생성 및 관리
 * - 요청 컨텍스트 정보 수집 (method, url, statusCode, latency)
 * - 모든 로그에 Trace ID 포함
 * - /health 경로는 로그에서 제외
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(private readonly cls?: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // /health 경로는 로그에서 제외
    if (request.url === '/health' || request.url.startsWith('/health/')) {
      return next.handle();
    }

    // Trace ID 생성 또는 기존 ID 사용 (이미 있다면)
    let traceId = request.headers['x-trace-id'] as string | undefined;
    if (!traceId) {
      traceId = randomUUID();
    }

    // CLS에 Trace ID 저장 (다른 서비스에서 접근 가능)
    if (this.cls) {
      try {
        this.cls.set('traceId', traceId);
      } catch {
        // CLS가 초기화되지 않은 경우 무시
      }
    }

    // 응답 헤더에 Trace ID 추가
    response.setHeader('X-Trace-Id', traceId);

    // 요청 시작 시간
    const startTime = Date.now();

    // 요청 메서드와 URL
    const method = request.method;
    const url = request.url;

    // 응답 처리 및 로깅
    return next.handle().pipe(
      tap({
        next: () => {
          const latency = Date.now() - startTime;
          const statusCode = response.statusCode;
          const externalCalls = this.cls?.get('externalCalls');

          // 로그 형식: [Method] [URL] [Status] [Latency]
          this.logger.log({
            message: `[${method}] ${url} [${statusCode}] ${latency}ms`,
            traceId,
            method,
            url,
            statusCode,
            latency: `${latency}ms`,
            ...(externalCalls ? { externalCalls } : {}),
          });
        },
        error: (error: unknown) => {
          const latency = Date.now() - startTime;
          const statusCode = response.statusCode || 500;
          const externalCalls = this.cls?.get('externalCalls');
          const errorObj =
            error instanceof Error ? error : new Error(String(error));

          // 에러 로그 형식: [Method] [URL] [Status] [Latency]
          this.logger.error({
            message: `[${method}] ${url} [${statusCode}] ${latency}ms`,
            traceId,
            method,
            url,
            statusCode,
            latency: `${latency}ms`,
            ...(externalCalls ? { externalCalls } : {}),
            error: {
              name: errorObj.name,
              message: errorObj.message,
              ...(statusCode >= 500 && errorObj.stack
                ? { stack: errorObj.stack }
                : {}),
            },
          });
        },
      }),
    );
  }
}
