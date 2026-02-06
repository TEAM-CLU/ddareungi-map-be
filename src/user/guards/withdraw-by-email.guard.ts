import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WithdrawByEmailGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    // 개발/테스트 환경에서만 허용 (운영에서는 엔드포인트 자체를 숨김)
    const nodeEnv =
      this.configService.get<string>('NODE_ENV') || process.env.NODE_ENV || '';
    const allowedEnvs = new Set(['local', 'development', 'dev', 'test']);
    if (!allowedEnvs.has(nodeEnv)) {
      throw new NotFoundException({
        statusCode: 404,
        message: 'Not Found',
      });
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
    }>();

    // 운영 환경에서도 반드시 토큰이 있어야 실행되도록 강제(메일만으로 탈퇴는 위험)
    const expected =
      this.configService.get<string>('WITHDRAW_BY_EMAIL_TOKEN') ||
      this.configService.get<string>('ADMIN_API_TOKEN');
    if (!expected) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message:
          'WITHDRAW_BY_EMAIL_TOKEN(또는 ADMIN_API_TOKEN) 환경변수가 설정되지 않았습니다.',
      });
    }

    // 헤더명은 두 가지를 허용(편의)
    const provided =
      request.headers['x-withdraw-by-email-token'] ||
      request.headers['x-admin-token'];

    if (!provided || provided !== expected) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: '권한이 없습니다.',
      });
    }

    return true;
  }
}

