import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import type {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { ClsService } from 'nestjs-cls';

type ExternalCalls = {
  http?: {
    total: number;
    success: number;
    fail: number;
    byTarget?: Record<string, { total: number; success: number; fail: number }>;
  };
};

function safeTarget(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes('seoul.go.kr')) return 'seoul-openapi';
    if (host.includes('graphhopper')) return 'graphhopper';
    if (host === 'localhost' || host === '127.0.0.1') return 'local';
    return host;
  } catch {
    return 'unknown';
  }
}

function safeUrlNoQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    // best effort: strip query string if present
    const idx = url.indexOf('?');
    return idx >= 0 ? url.slice(0, idx) : url;
  }
}

type AxiosInstanceWithFlag = AxiosInstance & {
  __ddareungi_http_logging_installed?: boolean;
};

type RequestMeta = {
  startTime: number;
  traceId?: string;
};

type ConfigWithMeta = AxiosRequestConfig & {
  __ddareungi_meta?: RequestMeta;
};

@Injectable()
export class HttpClientLoggingService implements OnModuleInit {
  private readonly logger = new Logger(HttpClientLoggingService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly cls: ClsService,
  ) {}

  onModuleInit(): void {
    const axios = this.httpService.axiosRef as AxiosInstanceWithFlag;
    if (axios.__ddareungi_http_logging_installed) return;
    axios.__ddareungi_http_logging_installed = true;

    axios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      const startTime = Date.now();
      const traceId = this.cls.get<string>('traceId');

      // Attach traceId header for downstream correlation (do not overwrite if already set)
      if (traceId) {
        const headersRecord = config.headers as unknown as Record<
          string,
          unknown
        >;
        const alreadyHasTrace =
          typeof headersRecord['x-trace-id'] === 'string' ||
          typeof headersRecord['X-Trace-Id'] === 'string';
        if (!alreadyHasTrace) {
          config.headers = {
            ...headersRecord,
            'x-trace-id': traceId,
          } as unknown as InternalAxiosRequestConfig['headers'];
        }
      }

      (config as unknown as ConfigWithMeta).__ddareungi_meta = {
        startTime,
        traceId,
      };
      return config;
    });

    axios.interceptors.response.use(
      (response: AxiosResponse) => {
        this.bumpCounters(response.config, true);
        return response;
      },
      (error: AxiosError) => {
        this.bumpCounters(error.config, false);

        // Failures are logged immediately (success is summarized per-request via CLS)
        const meta = (error.config as ConfigWithMeta | undefined)
          ?.__ddareungi_meta;
        const latency = meta?.startTime
          ? Date.now() - meta.startTime
          : undefined;

        const method = (error.config?.method || 'GET').toUpperCase();
        const rawUrl = this.absoluteUrl(error.config);
        const url = safeUrlNoQuery(rawUrl);
        const status = error.response?.status ?? 'ERROR';

        this.logger.error({
          message: `[HTTP] ${method} ${url} [${status}]${latency ? ` ${latency}ms` : ''}`,
          traceId: meta?.traceId,
          method,
          url,
          status,
          latency: latency ? `${latency}ms` : undefined,
          target: safeTarget(rawUrl),
          error: {
            name: error.name,
            message: error.message,
            ...(error.stack ? { stack: error.stack } : {}),
          },
        });

        return Promise.reject(error);
      },
    );
  }

  private absoluteUrl(config?: AxiosRequestConfig): string {
    const url = config?.url ?? '';
    const baseURL = config?.baseURL ?? '';
    try {
      return new URL(url, baseURL).toString();
    } catch {
      return `${baseURL}${url}`;
    }
  }

  private bumpCounters(
    config: AxiosRequestConfig | undefined,
    success: boolean,
  ): void {
    try {
      const meta = (config as ConfigWithMeta | undefined)?.__ddareungi_meta;
      const traceId = meta?.traceId ?? this.cls.get<string>('traceId');

      const rawUrl = this.absoluteUrl(config);
      const target = safeTarget(rawUrl);

      const existing = this.cls.get<ExternalCalls>('externalCalls') ?? {};
      const http = existing.http ?? {
        total: 0,
        success: 0,
        fail: 0,
        byTarget: {},
      };
      const byTarget = http.byTarget ?? {};
      const bucket = byTarget[target] ?? { total: 0, success: 0, fail: 0 };

      http.total += 1;
      if (success) http.success += 1;
      else http.fail += 1;

      bucket.total += 1;
      if (success) bucket.success += 1;
      else bucket.fail += 1;

      byTarget[target] = bucket;
      http.byTarget = byTarget;
      existing.http = http;

      // ensure traceId exists in CLS for downstream logs
      if (traceId) this.cls.set('traceId', traceId);
      this.cls.set('externalCalls', existing);
    } catch {
      // ignore CLS issues
    }
  }
}
