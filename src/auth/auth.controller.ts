import { Controller, Post, Body, HttpCode, HttpStatus, Get, Req, Res, UseGuards, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
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

  // ==================== PKCE 소셜 로그인 엔드포인트들 ====================

  @Get('google/pkce')
  @ApiOperation({ 
    summary: 'Google PKCE 로그인 URL 생성',
    description: 'PKCE 방식의 Google OAuth 2.0 로그인 URL을 생성합니다. 모바일 앱에서 사용하세요.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Google PKCE 로그인 URL 생성 성공',
    schema: {
      example: {
        message: 'Google PKCE 로그인 URL입니다.',
        authUrl: 'https://accounts.google.com/o/oauth2/auth?client_id=...',
        codeVerifier: 'xyz123...',
      }
    }
  })
  async getGooglePKCEUrl() {
    const result = this.authService.getGooglePKCEAuthUrl();
    return {
      message: 'Google PKCE 로그인 URL입니다.',
      ...result
    };
  }

  @Get('kakao/pkce')
  @ApiOperation({ 
    summary: 'Kakao PKCE 로그인 URL 생성',
    description: 'PKCE 방식의 Kakao OAuth 2.0 로그인 URL을 생성합니다. 모바일 앱에서 사용하세요.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Kakao PKCE 로그인 URL 생성 성공',
    schema: {
      example: {
        message: 'Kakao PKCE 로그인 URL입니다.',
        authUrl: 'https://kauth.kakao.com/oauth/authorize?client_id=...',
        codeVerifier: 'xyz123...',
      }
    }
  })
  async getKakaoPKCEUrl() {
    const result = this.authService.getKakaoPKCEAuthUrl();
    return {
      message: 'Kakao PKCE 로그인 URL입니다.',
      ...result
    };
  }

  @Get('naver/pkce')
  @ApiOperation({ 
    summary: 'Naver PKCE 로그인 URL 생성',
    description: 'PKCE 방식의 Naver OAuth 2.0 로그인 URL을 생성합니다. 모바일 앱에서 사용하세요.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Naver PKCE 로그인 URL 생성 성공',
    schema: {
      example: {
        message: 'Naver PKCE 로그인 URL입니다.',
        authUrl: 'https://nid.naver.com/oauth2.0/authorize?client_id=...',
        codeVerifier: 'xyz123...',
      }
    }
  })
  async getNaverPKCEUrl() {
    const result = this.authService.getNaverPKCEAuthUrl();
    return {
      message: 'Naver PKCE 로그인 URL입니다.',
      ...result
    };
  }

  @Get('google/pkce/callback')
  @ApiOperation({ 
    summary: 'Google PKCE 콜백 처리',
    description: 'Google OAuth 2.0 PKCE 인증 후 콜백을 처리합니다.'
  })
  async handleGooglePKCECallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response
  ) {
    try {
      // 회원가입/로그인 처리하고 state에 정보 저장
      const resultState = await this.authService.handleGooglePKCECallback(code, state);
      
      // 딥링크로 state 전달 (프론트에서 codeVerifier로 토큰 교환할 수 있도록)
      const successDeepLink = `${process.env.GOOGLE_PKCE_CALLBACK_URL}/?success=true&state=${resultState}&provider=google&message=${encodeURIComponent('Google 로그인 성공')}`;
      return res.redirect(successDeepLink);
      
    } catch (error) {
      const errorDeepLink = `${process.env.GOOGLE_PKCE_CALLBACK_URL}/?error=auth_failed&message=${encodeURIComponent(error.message)}`;
      return res.redirect(errorDeepLink);
    }
  }

  @Get('kakao/pkce/callback')
  @ApiOperation({ 
    summary: 'Kakao PKCE 콜백 처리',
    description: 'Kakao OAuth 2.0 PKCE 인증 후 콜백을 처리합니다.'
  })
  async handleKakaoPKCECallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response
  ) {
    try {
      // 회원가입/로그인 처리하고 state에 정보 저장
      const resultState = await this.authService.handleKakaoPKCECallback(code, state);
      
      // 딥링크로 state 전달 (프론트에서 codeVerifier로 토큰 교환할 수 있도록)
      const successDeepLink = `ddareungi://auth/?success=true&state=${resultState}&provider=kakao&message=${encodeURIComponent('Kakao 로그인 성공')}`;
      return res.redirect(successDeepLink);
      
    } catch (error) {
      const errorDeepLink = `ddareungi://auth/?error=auth_failed&message=${encodeURIComponent(error.message)}`;
      return res.redirect(errorDeepLink);
    }
  }

  @Get('naver/pkce/callback')
  @ApiOperation({ 
    summary: 'Naver PKCE 콜백 처리',
    description: 'Naver OAuth 2.0 PKCE 인증 후 콜백을 처리합니다.'
  })
  async handleNaverPKCECallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response
  ) {
    try {
      // 회원가입/로그인 처리하고 state에 정보 저장
      const resultState = await this.authService.handleNaverPKCECallback(code, state);
      
      // 딥링크로 state 전달 (프론트에서 codeVerifier로 토큰 교환할 수 있도록)
      const successDeepLink = `ddareungi://auth/callback?success=true&state=${resultState}&provider=naver&message=${encodeURIComponent('Naver 로그인 성공')}`;
      return res.redirect(successDeepLink);
      
    } catch (error) {
      const errorDeepLink = `ddareungi://auth/callback?error=auth_failed&message=${encodeURIComponent(error.message)}`;
      return res.redirect(errorDeepLink);
    }
  }

  @Post('exchange-token')
  @ApiOperation({ 
    summary: 'codeVerifier로 토큰 교환',
    description: '프론트에서 codeVerifier와 state를 사용하여 최종 JWT 토큰을 교환합니다.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        codeVerifier: { type: 'string', description: 'PKCE code verifier' },
        state: { type: 'string', description: '콜백에서 받은 state 값' }
      },
      required: ['codeVerifier', 'state']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: '토큰 교환 성공',
    schema: {
      example: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        user: {
          id: 'google123',
          name: '사용자',
          email: 'user@example.com'
        },
        message: '토큰 교환 성공'
      }
    }
  })
  @ApiResponse({ 
    status: 401, 
    description: '토큰 교환 실패',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid or expired state'
      }
    }
  })
  async exchangeToken(
    @Body('codeVerifier') codeVerifier: string,
    @Body('state') state: string
  ) {
    if (!codeVerifier || !state) {
      throw new BadRequestException('codeVerifier and state are required');
    }
    
    const result = await this.authService.exchangeTokenWithCodeVerifier(codeVerifier, state);
    
    return {
      accessToken: result.accessToken,
      user: result.user,
      message: '토큰 교환 성공'
    };
  }

  @Post('logout')
  @ApiOperation({ 
    summary: '로그아웃',
    description: 'HTTP-Only 쿠키를 삭제하여 로그아웃 처리합니다.'
  })
  @ApiResponse({ 
    status: 200, 
    description: '로그아웃 성공',
    schema: {
      example: {
        message: '로그아웃되었습니다.'
      }
    }
  })
  async logout(@Res() res: Response) {
    // 쿠키 삭제
    res.clearCookie('accessToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    });
    
    return res.json({
      message: '로그아웃되었습니다.'
    });
  }
}
