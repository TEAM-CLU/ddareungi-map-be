import { type RequestHandler } from 'express';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

const SWAGGER_BASIC_AUTH_REALM = 'Swagger Admin';

function safeEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function decodeBasicAuthHeader(value?: string): { username: string; password: string } | null {
  if (!value?.startsWith('Basic ')) {
    return null;
  }

  const encoded = value.slice('Basic '.length).trim();
  if (!encoded) {
    return null;
  }

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');

    if (separatorIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

export function isSwaggerEnabled(configService: ConfigService): boolean {
  const username = configService.get<string>('SWAGGER_ADMIN_USERNAME');
  const password = configService.get<string>('SWAGGER_ADMIN_PASSWORD');

  return Boolean(username && password);
}

export function buildSwaggerBasicAuthMiddleware(
  configService: ConfigService,
): RequestHandler {
  const expectedUsername =
    configService.get<string>('SWAGGER_ADMIN_USERNAME') ?? '';
  const expectedPassword =
    configService.get<string>('SWAGGER_ADMIN_PASSWORD') ?? '';

  return (request, response, next) => {
    const credentials = decodeBasicAuthHeader(request.headers.authorization);

    if (
      credentials &&
      safeEquals(credentials.username, expectedUsername) &&
      safeEquals(credentials.password, expectedPassword)
    ) {
      next();
      return;
    }

    response.setHeader(
      'WWW-Authenticate',
      `Basic realm="${SWAGGER_BASIC_AUTH_REALM}"`,
    );
    response.status(401).send('Authentication required.');
  };
}
