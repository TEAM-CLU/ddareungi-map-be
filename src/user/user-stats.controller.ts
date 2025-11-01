import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  UseGuards,
  Req,
  HttpStatus,
  HttpCode,
  HttpException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
interface AuthRequest extends ExpressRequest {
  user?: { userId: number };
}
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UserStatsService } from './services/user-stats.service';
import { UpdateUserStatsDto } from './dto/update-user-stats.dto';
import {
  SuccessResponseDto,
  ErrorResponseDto,
} from '../common/api-response.dto';

@ApiTags('User Stats')
@Controller('user/stats')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class UserStatsController {
  constructor(private readonly userStatsService: UserStatsService) {}

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '사용자 통계 업데이트',
    description:
      '사용자의 이용 통계를 업데이트합니다. 기존 데이터에 누적됩니다.',
  })
  @ApiBody({ type: UpdateUserStatsDto })
  @ApiResponse({
    status: 200,
    description: '통계 업데이트 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터',
    schema: {
      example: {
        statusCode: 400,
        message: ['총 거리는 양수여야 합니다.', '총 시간은 숫자여야 합니다.'],
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: '인증되지 않은 사용자',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized',
      },
    },
  })
  async updateStats(
    @Req() req: AuthRequest,
    @Body() updateUserStatsDto: UpdateUserStatsDto,
  ) {
    const userId = req.user?.userId;
    if (typeof userId !== 'number') {
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.UNAUTHORIZED,
          '유저 정보가 올바르지 않습니다.',
        ),
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      const stats = await this.userStatsService.updateUserStats(
        userId,
        updateUserStatsDto,
      );
      return SuccessResponseDto.create('통계 업데이트 성공', stats);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.BAD_REQUEST, message),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get()
  @ApiOperation({
    summary: '사용자 통계 조회',
    description: '현재 로그인한 사용자의 통계를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '통계 조회 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '통계 데이터가 없음',
    schema: {
      example: {
        statusCode: 404,
        message: '사용자 통계를 찾을 수 없습니다.',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: '인증되지 않은 사용자',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized',
      },
    },
  })
  async getStats(@Req() req: AuthRequest) {
    const userId = req.user?.userId;
    if (typeof userId !== 'number') {
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.UNAUTHORIZED,
          '유저 정보가 올바르지 않습니다.',
        ),
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      const stats = await this.userStatsService.getUserStats(userId);
      return SuccessResponseDto.create('통계 조회 성공', stats);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.BAD_REQUEST, message),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '사용자 통계 초기화',
    description: '현재 로그인한 사용자의 모든 통계를 0으로 초기화합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '통계 초기화 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '통계 데이터가 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '인증되지 않은 사용자',
    type: ErrorResponseDto,
  })
  async resetStats(@Req() req: AuthRequest) {
    const userId = req.user?.userId;
    if (typeof userId !== 'number') {
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.UNAUTHORIZED,
          '유저 정보가 올바르지 않습니다.',
        ),
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      await this.userStatsService.resetUserStats(userId);
      return SuccessResponseDto.create('통계 초기화 성공', null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.BAD_REQUEST, message),
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
