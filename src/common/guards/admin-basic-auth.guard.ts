import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ADMIN_BASIC_AUTH_REALM,
  decodeBasicAuthHeader,
  getSwaggerAdminCredentials,
  matchesBasicAuthCredentials,
} from '../auth/basic-auth.util';

@Injectable()
export class AdminBasicAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
    }>();
    const response = context.switchToHttp().getResponse<{
      setHeader(name: string, value: string): void;
    }>();

    const expectedCredentials = getSwaggerAdminCredentials(this.configService);

    if (!expectedCredentials) {
      throw new NotFoundException(
        '관리자 API가 비활성화되었습니다. Swagger 관리자 계정을 먼저 설정하세요.',
      );
    }

    const actualCredentials = decodeBasicAuthHeader(
      request.headers.authorization,
    );

    if (matchesBasicAuthCredentials(actualCredentials, expectedCredentials)) {
      return true;
    }

    response.setHeader(
      'WWW-Authenticate',
      `Basic realm="${ADMIN_BASIC_AUTH_REALM}"`,
    );
    throw new UnauthorizedException('관리자 인증이 필요합니다.');
  }
}
