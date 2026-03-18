import { type RequestHandler } from 'express';
import { ConfigService } from '@nestjs/config';
import {
  decodeBasicAuthHeader,
  getSwaggerAdminCredentials,
  hasSwaggerAdminCredentials,
  matchesBasicAuthCredentials,
} from '../auth/basic-auth.util';

const SWAGGER_BASIC_AUTH_REALM = 'Swagger Admin';

export function isSwaggerEnabled(configService: ConfigService): boolean {
  return hasSwaggerAdminCredentials(configService);
}

export function buildSwaggerBasicAuthMiddleware(
  configService: ConfigService,
): RequestHandler {
  const expectedCredentials = getSwaggerAdminCredentials(configService);

  return (request, response, next) => {
    const credentials = decodeBasicAuthHeader(request.headers.authorization);

    if (
      expectedCredentials &&
      matchesBasicAuthCredentials(credentials, expectedCredentials)
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
