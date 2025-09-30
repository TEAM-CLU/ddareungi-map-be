import { Controller, Post, Body, HttpCode, HttpStatus, Get, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { BadRequestException } from '@nestjs/common';
import { 
  SendVerificationEmailDto, 
  VerifyEmailDto
} from './dto/email-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';

declare module 'express' {
  interface Request {
    user?: any; // 사용자 정보를 적절히 정의
  }
}

@ApiTags('인증 (Authentication)')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('send-verification-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '이메일 인증 코드 발송',
    description: '지정된 이메일 주소로 6자리 인증 코드를 발송합니다. 인증 코드는 10분간 유효합니다.'
  })
  @ApiBody({ type: SendVerificationEmailDto })
  @ApiResponse({ 
    status: 200, 
    description: '인증 코드 발송 성공',
    schema: {
      example: {
        message: '인증 코드가 이메일로 발송되었습니다. 10분 내에 인증을 완료해주세요.'
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: '잘못된 요청 (이메일 형식 오류, 재전송 시간 제한 등)',
    schema: {
      example: {
        statusCode: 400,
        message: '인증 코드는 1분에 한 번만 요청할 수 있습니다.'
      }
    }
  })
  async sendVerificationEmail(@Body() sendVerificationEmailDto: SendVerificationEmailDto) {
    return await this.authService.sendVerificationEmail(sendVerificationEmailDto);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '이메일 인증 코드 확인',
    description: '발송된 6자리 인증 코드를 확인하여 이메일 인증을 완료합니다.'
  })
  @ApiBody({ type: VerifyEmailDto })
  @ApiResponse({ 
    status: 200, 
    description: '이메일 인증 성공',
    schema: {
      example: {
        message: '이메일 인증이 완료되었습니다.',
        isVerified: true
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: '인증 실패 (잘못된 코드, 만료된 코드, 시도 횟수 초과 등)',
    schema: {
      example: {
        statusCode: 400,
        message: '인증 코드가 일치하지 않습니다. (3/5)'
      }
    }
  })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return await this.authService.verifyEmail(verifyEmailDto);
  }

  @Get('naver')
  @UseGuards(AuthGuard('naver'))
  async naverLogin() {
    // 네이버 로그인 페이지로 리디렉션
    return {
      message: '네이버 로그인 페이지로 리디렉션 중입니다.',
    };
  }

  @Get('kakao')
  @UseGuards(AuthGuard('kakao'))
  async kakaoLogin() {
    // 카카오 로그인 페이지로 리디렉션
    return {
      message: '카카오 로그인 페이지로 리디렉션 중입니다.',
    };
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleLogin() {
    // 구글 로그인 페이지로 리디렉션
    return {
      message: '구글 로그인 페이지로 리디렉션 중입니다.',
    };
  }
  /* Get google Auth Callback */
  @Get('/google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthCallback(
    @Req() req: Request,
    @Res() res: Response, // : Promise<NaverLoginAuthOutputDto>
  ) {
    const { user } = req;
    return res.send(user);
    // return this.authService.handleNaverLogin(req);
    return {
      message: '구글 로그인 콜백 처리 중입니다.',
    };
  }

  /* Get naver Auth Callback */
  @Get('/naver/callback')
  @UseGuards(AuthGuard('naver'))
  async naverAuthCallback(
    @Req() req: Request,
    @Res() res: Response, // : Promise<NaverLoginAuthOutputDto>
  ) {
    const { user } = req;
    return res.send(user);
    // return this.authService.handleNaverLogin(req);
  }

  /* Get kakao Auth Callback */
  @Get('/kakao/callback')
  @UseGuards(AuthGuard('kakao'))
  async kakaoAuthCallback(
    @Req() req: Request,
    @Res() res: Response, // : Promise<NaverLoginAuthOutputDto>
  ) {
    const { user } = req;
    return res.send(user);
    // return this.authService.handleNaverLogin(req);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '비밀번호 재설정',
    description: '이메일 인증 완료 후 새로운 비밀번호로 재설정합니다. 먼저 이메일 인증(/auth/send-verification-email, /auth/verify-email)을 완료해야 합니다.'
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ 
    status: 200, 
    description: '비밀번호 재설정 성공',
    schema: {
      example: {
        message: '비밀번호가 성공적으로 재설정되었습니다.'
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: '잘못된 요청 (현재 비밀번호와 동일, 유효성 검사 실패 등)',
    schema: {
      example: {
        statusCode: 400,
        message: '현재 사용 중인 비밀번호와 동일합니다. 다른 비밀번호를 입력해주세요.'
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: '사용자를 찾을 수 없음',
    schema: {
      example: {
        statusCode: 404,
        message: '해당 이메일로 등록된 사용자를 찾을 수 없습니다.'
      }
    }
  })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    return await this.authService.resetPassword(resetPasswordDto);
  }
}
