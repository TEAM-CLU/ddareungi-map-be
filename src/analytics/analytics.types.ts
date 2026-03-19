import type { Request } from 'express';

export type AnalyticsAuthState = 'anonymous' | 'authenticated';

export type AnalyticsIdentity = {
  clientId: string;
  userId?: string;
  authState: AnalyticsAuthState;
};

export type TrackEventInput = {
  name: string;
  identity: AnalyticsIdentity;
  params?: Record<string, string | number | boolean | null | undefined>;
};

export type AnalyticsRequest = Request & {
  user?: {
    userId?: string | number;
  };
};
