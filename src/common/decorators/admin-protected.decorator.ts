import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBasicAuth } from '@nestjs/swagger';
import { AdminBasicAuthGuard } from '../guards/admin-basic-auth.guard';
import { ADMIN_BASIC_AUTH_SWAGGER_SCHEME } from '../auth/basic-auth.util';

export function AdminProtected() {
  return applyDecorators(
    UseGuards(AdminBasicAuthGuard),
    ApiBasicAuth(ADMIN_BASIC_AUTH_SWAGGER_SCHEME),
  );
}
