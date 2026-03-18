import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

export type BasicAuthCredentials = {
  username: string;
  password: string;
};

export const ADMIN_BASIC_AUTH_REALM = 'Admin API';
export const ADMIN_BASIC_AUTH_SWAGGER_SCHEME = 'admin-basic';

function safeEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function decodeBasicAuthHeader(
  value?: string,
): BasicAuthCredentials | null {
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

export function getSwaggerAdminCredentials(
  configService: ConfigService,
): BasicAuthCredentials | null {
  const username = configService.get<string>('SWAGGER_ADMIN_USERNAME');
  const password = configService.get<string>('SWAGGER_ADMIN_PASSWORD');

  if (!username || !password) {
    return null;
  }

  return { username, password };
}

export function hasSwaggerAdminCredentials(
  configService: ConfigService,
): boolean {
  return Boolean(getSwaggerAdminCredentials(configService));
}

export function matchesBasicAuthCredentials(
  actual: BasicAuthCredentials | null,
  expected: BasicAuthCredentials,
): boolean {
  return Boolean(
    actual &&
      safeEquals(actual.username, expected.username) &&
      safeEquals(actual.password, expected.password),
  );
}
