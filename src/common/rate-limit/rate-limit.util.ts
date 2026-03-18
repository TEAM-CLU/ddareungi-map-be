import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

const DEFAULT_RATE_LIMITS = {
  appLimit: 120,
  appTtlSeconds: 60,
  authPollLimit: 30,
  authPollTtlSeconds: 60,
  adminLimit: 20,
  adminTtlSeconds: 60,
  benchmarkLimit: 5,
  benchmarkTtlSeconds: 60,
  slowRequestThresholdProductionMs: 1000,
  slowRequestThresholdDevelopmentMs: 3000,
} as const;

function getPositiveNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function toMilliseconds(seconds: number): number {
  return seconds * 1000;
}

export function getAppRateLimit() {
  return {
    limit: () =>
      getPositiveNumberFromEnv(
        'APP_RATE_LIMIT_LIMIT',
        DEFAULT_RATE_LIMITS.appLimit,
      ),
    ttl: () =>
      toMilliseconds(
        getPositiveNumberFromEnv(
          'APP_RATE_LIMIT_TTL_SECONDS',
          DEFAULT_RATE_LIMITS.appTtlSeconds,
        ),
      ),
  };
}

export function getAuthPollRateLimit() {
  return {
    limit: () =>
      getPositiveNumberFromEnv(
        'AUTH_POLL_RATE_LIMIT_LIMIT',
        DEFAULT_RATE_LIMITS.authPollLimit,
      ),
    ttl: () =>
      toMilliseconds(
        getPositiveNumberFromEnv(
          'AUTH_POLL_RATE_LIMIT_TTL_SECONDS',
          DEFAULT_RATE_LIMITS.authPollTtlSeconds,
        ),
      ),
  };
}

export function getAdminRateLimit() {
  return {
    limit: () =>
      getPositiveNumberFromEnv(
        'ADMIN_RATE_LIMIT_LIMIT',
        DEFAULT_RATE_LIMITS.adminLimit,
      ),
    ttl: () =>
      toMilliseconds(
        getPositiveNumberFromEnv(
          'ADMIN_RATE_LIMIT_TTL_SECONDS',
          DEFAULT_RATE_LIMITS.adminTtlSeconds,
        ),
      ),
  };
}

export function getBenchmarkRateLimit() {
  return {
    limit: () =>
      getPositiveNumberFromEnv(
        'BENCHMARK_RATE_LIMIT_LIMIT',
        DEFAULT_RATE_LIMITS.benchmarkLimit,
      ),
    ttl: () =>
      toMilliseconds(
        getPositiveNumberFromEnv(
          'BENCHMARK_RATE_LIMIT_TTL_SECONDS',
          DEFAULT_RATE_LIMITS.benchmarkTtlSeconds,
        ),
      ),
  };
}

export function getSlowRequestThresholdMs(nodeEnv: string): number {
  return getPositiveNumberFromEnv(
    'HTTP_SLOW_REQUEST_THRESHOLD_MS',
    nodeEnv === 'production'
      ? DEFAULT_RATE_LIMITS.slowRequestThresholdProductionMs
      : DEFAULT_RATE_LIMITS.slowRequestThresholdDevelopmentMs,
  );
}

export function shouldSkipGlobalRateLimit(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest<Request>();
  const path = request.path || request.url || '';

  return (
    path === '/health' ||
    path.startsWith('/health/') ||
    path === '/api-docs' ||
    path.startsWith('/api-docs/') ||
    path === '/api-docs-json'
  );
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  return request.ip || 'unknown';
}
