import { HttpException } from '@nestjs/common';

export const GA4_MEASUREMENT_PROTOCOL_URL =
  'https://www.google-analytics.com/mp/collect';

export const ANALYTICS_HEADER_GA_CLIENT_ID = 'x-ga-client-id';
export const ANALYTICS_HEADER_ANONYMOUS_APP_ID = 'x-anonymous-app-id';
export const ANALYTICS_HEADER_AUTHORIZATION = 'authorization';

export const ANALYTICS_EVENT_STATION_SEARCH = 'station_search';
export const ANALYTICS_EVENT_ROUTE_SEARCH_COMPLETED = 'route_search_completed';
export const ANALYTICS_EVENT_NAVIGATION_STARTED = 'navigation_started';
export const ANALYTICS_EVENT_NAVIGATION_UPDATED = 'navigation_updated';
export const ANALYTICS_EVENT_NAVIGATION_COMPLETED = 'navigation_completed';
export const ANALYTICS_EVENT_API_OPERATION_RESULT = 'api_operation_result';
export const ANALYTICS_EVENT_EXTERNAL_DEPENDENCY_RESULT =
  'external_dependency_result';

export function toRadiusBucket(radius?: number): string | undefined {
  if (typeof radius !== 'number' || radius < 0) {
    return undefined;
  }
  if (radius <= 500) {
    return '0_500';
  }
  if (radius <= 1000) {
    return '501_1000';
  }
  if (radius <= 3000) {
    return '1001_3000';
  }
  return '3001_plus';
}

export function toResultCountBucket(count: number): string {
  if (count <= 0) {
    return '0';
  }
  if (count <= 3) {
    return '1_3';
  }
  if (count <= 10) {
    return '4_10';
  }
  return '11_plus';
}

export function toInstructionCountBucket(count: number): string {
  if (count <= 0) {
    return '0';
  }
  if (count <= 5) {
    return '1_5';
  }
  if (count <= 15) {
    return '6_15';
  }
  return '16_plus';
}

export function getHttpStatusFromError(error: unknown): number {
  if (error instanceof HttpException) {
    return error.getStatus();
  }
  return 500;
}

export function getErrorType(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'constructor' in error &&
    typeof (error as { constructor?: { name?: unknown } }).constructor?.name ===
      'string'
  ) {
    return (error as { constructor: { name: string } }).constructor.name;
  }

  return 'UnknownError';
}
