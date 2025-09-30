import { Controller, Post, Get, Put, Body, Request, HttpCode, HttpStatus, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from './user.service';
import { 
  CreateUserDto
} from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { UserInfoResponseDto } from './dto/user-info-response.dto';
import { UpdateUserInfoDto } from './dto/update-user-info.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MyPageInfoResponseDto } from './dto/mypage-info-response.dto';
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
    description: '지정된 형식을 통하여 회원가입을 진행합니다.'
  })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ 
    status: 200, 
    description: '회원가입 성공',
    schema: {
      example: {
        message: '회원가입이 완료되었습니다.'
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: '잘못된 요청 (이메일 형식 오류, 재전송 시간 제한 등)',
    schema: {
      example: {
        statusCode: 400,
        message: '회원가입에 실패하였습니다. 다시 시도해주세요',
        error: 'Bad Request'
      }
    }
  })
  async createUser(@Body() createUserDto: CreateUserDto) {
    return await this.userService.register(createUserDto);
  }

  @Post('login-user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '유저 로그인',
    description: '지정된 형식을 통하여 로그인을 진행합니다.'
  })
  @ApiBody({ type: LoginUserDto })
  @ApiResponse({ 
    status: 200, 
    description: '로그인 성공',
    schema: {
      example: {
        message: '로그인이 완료되었습니다.'
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: '잘못된 요청 (이메일 오류, 비밀번호 오류)',
    schema: {
      example: {
        statusCode: 400,
        message: '로그인에 실패하였습니다. 다시 시도해주세요',
        error: 'Bad Request'
      }
    }
  })
  async loginUser(@Body() loginUserDto: LoginUserDto) {
    return await this.userService.login(loginUserDto);
  }

  @Get('info')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: '내 정보 조회',
    description: 'JWT 토큰을 통해 현재 로그인한 사용자의 정보를 조회합니다.'
  })
  @ApiResponse({ 
    status: 200, 
    description: '사용자 정보 조회 성공',
    type: UserInfoResponseDto
  })
  @ApiResponse({ 
    status: 401, 
    description: '인증되지 않은 사용자 (토큰 없음 또는 유효하지 않은 토큰)',
    schema: {
      example: {
        statusCode: 401,
        message: '유효하지 않은 토큰입니다.',
        error: 'Unauthorized'
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: '사용자를 찾을 수 없음',
    schema: {
      example: {
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
        error: 'Not Found'
      }
    }
  })
  async getUserInfo(@Request() req): Promise<UserInfoResponseDto> {
    const userId = req.user.userId;
    return await this.userService.getUserInfo(userId);
  }

  @Put('info-update')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: '내 정보 수정',
    description: 'JWT 토큰을 통해 현재 로그인한 사용자의 정보를 수정합니다.'
  })
  @ApiBody({ type: UpdateUserInfoDto })
  @ApiResponse({ 
    status: 200, 
    description: '사용자 정보 수정 성공',
    type: UserInfoResponseDto
  })
  @ApiResponse({ 
    status: 400, 
    description: '잘못된 요청 (유효성 검사 실패, 올바르지 않은 생년월일 형식 등)',
    schema: {
      example: {
        statusCode: 400,
        message: '올바르지 않은 생년월일 형식입니다.',
        error: 'Bad Request'
      }
    }
  })
  @ApiResponse({ 
    status: 401, 
    description: '인증되지 않은 사용자 (토큰 없음 또는 유효하지 않은 토큰)',
    schema: {
      example: {
        statusCode: 401,
        message: '유효하지 않은 토큰입니다.',
        error: 'Unauthorized'
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: '사용자를 찾을 수 없음',
    schema: {
      example: {
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
        error: 'Not Found'
      }
    }
  })
  async updateUserInfo(@Request() req, @Body() updateUserInfoDto: UpdateUserInfoDto): Promise<UserInfoResponseDto> {
    const userId = req.user.userId;
    return await this.userService.updateUserInfo(userId, updateUserInfoDto);
  }

  @Put('password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: '비밀번호 변경',
    description: 'JWT 토큰을 통해 현재 로그인한 사용자의 비밀번호를 변경합니다.'
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ 
    status: 200, 
    description: '비밀번호 변경 성공',
    schema: {
      example: {
        message: '비밀번호가 성공적으로 변경되었습니다.'
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: '잘못된 요청 (같은 비밀번호, 유효성 검사 실패 등)',
    schema: {
      example: {
        statusCode: 400,
        message: '같은 비밀번호입니다. 다른 비밀번호를 입력해주세요.',
        error: 'Bad Request'
      }
    }
  })
  @ApiResponse({ 
    status: 401, 
    description: '인증되지 않은 사용자 (토큰 없음, 유효하지 않은 토큰, 현재 비밀번호 불일치)',
    schema: {
      example: {
        statusCode: 401,
        message: '현재 비밀번호가 올바르지 않습니다.',
        error: 'Unauthorized'
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: '사용자를 찾을 수 없음',
    schema: {
      example: {
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
        error: 'Not Found'
      }
    }
  })
  async changePassword(@Request() req, @Body() changePasswordDto: ChangePasswordDto): Promise<{ message: string }> {
    const userId = req.user.userId;
    return await this.userService.changePassword(userId, changePasswordDto);
  }

  @Get('mypage')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: '마이페이지 정보 조회',
    description: 'JWT 토큰을 통해 현재 로그인한 사용자의 마이페이지 정보를 조회합니다. name, email은 실제 데이터를, 나머지는 향후 구현 예정으로 null을 반환합니다.'
  })
  @ApiResponse({ 
    status: 200, 
    description: '마이페이지 정보 조회 성공',
    type: MyPageInfoResponseDto
  })
  @ApiResponse({ 
    status: 401, 
    description: '인증되지 않은 사용자 (토큰 없음 또는 유효하지 않은 토큰)',
    schema: {
      example: {
        statusCode: 401,
        message: '유효하지 않은 토큰입니다.',
        error: 'Unauthorized'
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: '사용자를 찾을 수 없음',
    schema: {
      example: {
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
        error: 'Not Found'
      }
    }
  })
  async getMyPageInfo(@Request() req): Promise<MyPageInfoResponseDto> {
    const userId = req.user.userId;
    return await this.userService.getMyPageInfo(userId);
  }

  @Post('check-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '이메일 중복 확인',
    description: '회원가입 시 이메일 중복 여부를 확인합니다.'
  })
  @ApiBody({ type: CheckEmailDto })
  @ApiResponse({ 
    status: 200, 
    description: '이메일 중복 확인 성공',
    schema: {
      example: {
        isAvailable: true,
        message: '사용 가능한 이메일입니다.'
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: '잘못된 요청 (이메일 형식 오류)',
    schema: {
      example: {
        statusCode: 400,
        message: [
          'email must be an email'
        ],
        error: 'Bad Request'
      }
    }
  })
  async checkEmail(@Body() checkEmailDto: CheckEmailDto): Promise<{ isAvailable: boolean; message: string }> {
    return await this.userService.checkEmailExists(checkEmailDto);
  }

}
