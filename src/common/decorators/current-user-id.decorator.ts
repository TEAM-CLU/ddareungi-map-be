import {
  UnauthorizedException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): number => {
    const request = context.switchToHttp().getRequest<{
      user?: { userId?: number };
    }>();
    const userId = request.user?.userId;

    if (typeof userId !== 'number') {
      throw new UnauthorizedException({
        statusCode: 401,
        message: '유저 정보가 올바르지 않습니다.',
      });
    }

    return userId;
  },
);
