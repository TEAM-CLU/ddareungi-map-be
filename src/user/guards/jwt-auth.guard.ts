import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private jwtService: JwtService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: '토큰이 제공되지 않았습니다.',
      });
    }

    const token = authHeader.replace('Bearer ', '');
    
    try {
      const decoded = this.jwtService.verify(token);
      request.user = decoded;
      return true;
    } catch (error) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: '유효하지 않은 토큰입니다.',
      });
    }
  }
}