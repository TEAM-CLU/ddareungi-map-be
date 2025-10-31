import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
// JWT payload 타입을 명확히 명시
type JwtPayload = {
  userId?: string | number;
  sub?: string | number;
  [key: string]: unknown;
};

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private jwtService: JwtService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: { userId: number };
    }>();
    const authHeader = request.headers['authorization'];

    if (!authHeader) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: '토큰이 제공되지 않았습니다.',
      });
    }

    const token = authHeader.replace('Bearer ', '');

    try {
      const decoded: JwtPayload = this.jwtService.verify(token);
      // userId가 없으면 sub도 fallback으로 지원
      const rawUserId = decoded.userId ?? decoded.sub;
      let userId: number | undefined;
      if (typeof rawUserId === 'string') {
        const parsed = parseInt(rawUserId, 10);
        if (!isNaN(parsed)) userId = parsed;
      } else if (typeof rawUserId === 'number') {
        userId = rawUserId;
      }
      if (typeof userId === 'number') {
        request.user = { userId };
        return true;
      }
      throw new UnauthorizedException({
        statusCode: 401,
        message: '토큰에 userId가 포함되어 있지 않습니다.',
      });
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        message: '유효하지 않은 토큰입니다.',
      });
    }
  }
}
