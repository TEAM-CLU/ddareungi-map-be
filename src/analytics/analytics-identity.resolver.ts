import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import {
  ANALYTICS_HEADER_ANONYMOUS_APP_ID,
  ANALYTICS_HEADER_AUTHORIZATION,
  ANALYTICS_HEADER_GA_CLIENT_ID,
} from './analytics.constants';
import type { AnalyticsIdentity, AnalyticsRequest } from './analytics.types';

type JwtPayload = {
  userId?: string | number;
  sub?: string | number;
};

@Injectable()
export class AnalyticsIdentityResolver {
  private readonly logger = new Logger(AnalyticsIdentityResolver.name);
  private hasLoggedEphemeralClientIdWarning = false;

  constructor(private readonly jwtService: JwtService) {}

  resolve(request: AnalyticsRequest): AnalyticsIdentity {
    const clientId =
      this.getFirstHeaderValue(request, ANALYTICS_HEADER_GA_CLIENT_ID) ??
      this.getFirstHeaderValue(request, ANALYTICS_HEADER_ANONYMOUS_APP_ID) ??
      this.createEphemeralClientId();

    const requestUserId = request.user?.userId;
    const userId =
      this.normalizeUserId(requestUserId) ?? this.resolveUserIdFromJwt(request);

    return {
      clientId,
      ...(userId ? { userId } : undefined),
      authState: userId ? 'authenticated' : 'anonymous',
    };
  }

  private resolveUserIdFromJwt(request: AnalyticsRequest): string | undefined {
    const authorization = this.getFirstHeaderValue(
      request,
      ANALYTICS_HEADER_AUTHORIZATION,
    );

    if (!authorization?.startsWith('Bearer ')) {
      return undefined;
    }

    try {
      const token = authorization.slice('Bearer '.length).trim();
      const decoded = this.jwtService.verify<JwtPayload>(token);
      return this.normalizeUserId(decoded.userId ?? decoded.sub);
    } catch {
      return undefined;
    }
  }

  private getFirstHeaderValue(
    request: AnalyticsRequest,
    headerName: string,
  ): string | undefined {
    const raw = request.headers[headerName];
    if (typeof raw === 'string') {
      return raw.trim() || undefined;
    }

    if (Array.isArray(raw)) {
      const first = raw.find((value) => typeof value === 'string' && value);
      return typeof first === 'string' ? first.trim() || undefined : undefined;
    }

    return undefined;
  }

  private normalizeUserId(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    return undefined;
  }

  private createEphemeralClientId(): string {
    if (!this.hasLoggedEphemeralClientIdWarning) {
      this.logger.warn(
        'GA4 client_id header가 없어 임시 UUID를 사용합니다. revisit KPI 정확도가 낮아질 수 있습니다.',
      );
      this.hasLoggedEphemeralClientIdWarning = true;
    }

    return randomUUID();
  }
}
