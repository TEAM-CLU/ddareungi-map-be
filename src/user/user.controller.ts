import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  HttpException,
} from '@nestjs/common';

import type { Request as ExpressRequest } from 'express';

interface AuthRequest extends ExpressRequest {
  user?: { userId: number };
}
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { UpdateUserInfoDto } from './dto/update-user-info.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MyPageInfoResponseDto } from './dto/mypage-info-response.dto';
import {
  SuccessResponseDto,
  ErrorResponseDto,
} from '../common/api-response.dto';
import { CheckEmailDto } from './dto/check-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('유저 (User)')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('create-user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '유저 회원가입',
    description: '지정된 형식을 통하여 회원가입을 진행합니다.',
  })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({
    status: 200,
    description: '회원가입 성공',
    type: SuccessResponseDto,
    schema: {
      example: {
        statusCode: 200,
        message: '회원가입이 완료되었습니다.',
        data: null,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (이메일 형식 오류, 재전송 시간 제한 등)',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 400,
        message: '회원가입에 실패하였습니다. 다시 시도해주세요',
      },
    },
  })
  async createUser(@Body() createUserDto: CreateUserDto) {
    try {
      await this.userService.register(createUserDto);
      return SuccessResponseDto.create('회원가입이 완료되었습니다.', null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.BAD_REQUEST, message),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('login-user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '유저 로그인',
    description: '지정된 형식을 통하여 로그인을 진행합니다.',
  })
  @ApiBody({ type: LoginUserDto })
  @ApiResponse({
    status: 200,
    description: '로그인 성공',
    type: SuccessResponseDto,
    schema: {
      example: {
        statusCode: 200,
        message: '로그인이 완료되었습니다.',
        data: {
          access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (이메일 오류, 비밀번호 오류)',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 400,
        message: '로그인에 실패하였습니다. 다시 시도해주세요',
      },
    },
  })
  async loginUser(@Body() loginUserDto: LoginUserDto) {
    try {
      const result = await this.userService.login(loginUserDto);
      return SuccessResponseDto.create('로그인이 완료되었습니다.', result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.BAD_REQUEST, message),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('info')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: '내 정보 조회',
    description: 'JWT 토큰을 통해 현재 로그인한 사용자의 정보를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '사용자 정보 조회 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '인증되지 않은 사용자 (토큰 없음 또는 유효하지 않은 토큰)',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 401,
        message: '유효하지 않은 토큰입니다.',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '사용자를 찾을 수 없음',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
      },
    },
  })
  async getUserInfo(@Req() req: AuthRequest) {
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
      const userInfo = await this.userService.getUserInfo(userId);
      return SuccessResponseDto.create('사용자 정보 조회 성공', userInfo);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.BAD_REQUEST, message),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Put('info-update')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: '내 정보 수정',
    description: 'JWT 토큰을 통해 현재 로그인한 사용자의 정보를 수정합니다.',
  })
  @ApiBody({ type: UpdateUserInfoDto })
  @ApiResponse({
    status: 200,
    description: '사용자 정보 수정 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      '잘못된 요청 (유효성 검사 실패, 올바르지 않은 생년월일 형식 등)',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 400,
        message: '올바르지 않은 생년월일 형식입니다.',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: '인증되지 않은 사용자 (토큰 없음 또는 유효하지 않은 토큰)',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 401,
        message: '유효하지 않은 토큰입니다.',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '사용자를 찾을 수 없음',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
      },
    },
  })
  async updateUserInfo(
    @Req() req: AuthRequest,
    @Body() updateUserInfoDto: UpdateUserInfoDto,
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
      const updatedInfo = await this.userService.updateUserInfo(
        userId,
        updateUserInfoDto,
      );
      return SuccessResponseDto.create('사용자 정보 수정 성공', updatedInfo);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.BAD_REQUEST, message),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Put('password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: '비밀번호 변경',
    description:
      'JWT 토큰을 통해 현재 로그인한 사용자의 비밀번호를 변경합니다.',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: 200,
    description: '비밀번호 변경 성공',
    type: SuccessResponseDto,
    schema: {
      example: {
        statusCode: 200,
        message: '비밀번호가 성공적으로 변경되었습니다.',
        data: null,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (같은 비밀번호, 유효성 검사 실패 등)',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 400,
        message: '같은 비밀번호입니다. 다른 비밀번호를 입력해주세요.',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description:
      '인증되지 않은 사용자 (토큰 없음, 유효하지 않은 토큰, 현재 비밀번호 불일치)',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 401,
        message: '현재 비밀번호가 올바르지 않습니다.',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '사용자를 찾을 수 없음',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
      },
    },
  })
  async changePassword(
    @Req() req: AuthRequest,
    @Body() changePasswordDto: ChangePasswordDto,
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
      await this.userService.changePassword(userId, changePasswordDto);
      return SuccessResponseDto.create(
        '비밀번호가 성공적으로 변경되었습니다.',
        null,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.BAD_REQUEST, message),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('mypage')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: '마이페이지 정보 조회',
    description:
      'JWT 토큰을 통해 현재 로그인한 사용자의 마이페이지 정보를 조회합니다. name, email은 실제 데이터를, 나머지는 향후 구현 예정으로 null을 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '마이페이지 정보 조회 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '인증되지 않은 사용자 (토큰 없음 또는 유효하지 않은 토큰)',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 401,
        message: '유효하지 않은 토큰입니다.',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '사용자를 찾을 수 없음',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
      },
    },
  })
  async getMyPageInfo(@Req() req: AuthRequest) {
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
      const myPage: MyPageInfoResponseDto =
        await this.userService.getMyPageInfo(userId);
      return SuccessResponseDto.create('마이페이지 정보 조회 성공', myPage);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.BAD_REQUEST, message),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('check-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '이메일 중복 확인',
    description: '회원가입 시 이메일 중복 여부를 확인합니다.',
  })
  @ApiBody({ type: CheckEmailDto })
  @ApiResponse({
    status: 200,
    description: '사용 가능한 이메일',
    type: SuccessResponseDto,
    schema: {
      example: {
        statusCode: 200,
        message: '사용 가능한 이메일입니다.',
        data: null,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (이메일 형식 오류)',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 400,
        message: '이메일 형식이 올바르지 않습니다.',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: '이메일 중복',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 409,
        message: '이메일이 이미 존재합니다.',
      },
    },
  })
  async checkEmail(@Body() checkEmailDto: CheckEmailDto) {
    try {
      await this.userService.checkEmailExists(checkEmailDto);
      return SuccessResponseDto.create('사용 가능한 이메일입니다.', null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      const statusCode =
        message.includes('이미 존재') || message.includes('중복')
          ? HttpStatus.CONFLICT
          : HttpStatus.BAD_REQUEST;
      throw new HttpException(
        ErrorResponseDto.create(statusCode, message),
        statusCode,
      );
    }
  }

  @Delete('withdraw')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: '회원 탈퇴',
    description:
      'JWT 토큰을 통해 현재 로그인한 사용자의 계정을 탈퇴(삭제)합니다. 연관된 데이터는 cascade로 함께 삭제됩니다.',
  })
  @ApiResponse({
    status: 200,
    description: '회원 탈퇴 성공',
    type: SuccessResponseDto,
    schema: {
      example: {
        statusCode: 200,
        message: '회원 탈퇴가 완료되었습니다.',
        data: null,
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: '인증되지 않은 사용자 (토큰 없음 또는 유효하지 않은 토큰)',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 401,
        message: '유효하지 않은 토큰입니다.',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '사용자를 찾을 수 없음',
    type: ErrorResponseDto,
    schema: {
      example: {
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
      },
    },
  })
  async withdrawUser(@Req() req: AuthRequest) {
    if (!req.user || typeof req.user.userId !== 'number') {
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.UNAUTHORIZED,
          '유저 정보가 올바르지 않습니다.',
        ),
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      await this.userService.withdraw(req.user.userId);
      return SuccessResponseDto.create('회원 탈퇴가 완료되었습니다.', null);
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
