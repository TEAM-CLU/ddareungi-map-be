import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  Req,
  Res,
  UseGuards,
  Query,
  Param,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  SendVerificationEmailDto,
  VerifyEmailDto,
} from './dto/email-verification.dto';
import { FindAccountRequestDto } from './dto/find-account.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import {
  SuccessResponseDto,
  ErrorResponseDto,
} from '../common/api-response.dto';
import { isPkceErrorCode } from './pkce-error-code';
import * as crypto from 'crypto';

declare module 'express' {
  interface Request {
    user?: any; // 사용자 정보를 적절히 정의
  }
}

@ApiTags('인증 (Authentication)')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  private hashForLog(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
  }

  private buildAuthResultRedirectUrl(params: {
    status: 'success' | 'error';
    provider: 'google' | 'kakao' | 'naver';
    state?: string;
    errorCode?: string;
    errorMessage?: string;
  }): string {
    const frag = new URLSearchParams();
    frag.set('status', params.status);
    frag.set('provider', params.provider);
    if (params.state) frag.set('state', params.state);
    if (params.errorCode) frag.set('errorCode', params.errorCode);
    if (params.errorMessage) frag.set('errorMessage', params.errorMessage);
    // 결과 페이지는 고정 경로만 사용 (오픈 리다이렉트 방지)
    return `/auth_result.html#${frag.toString()}`;
  }

  private mapProviderOAuthErrorToErrorCode(
    oauthError?: string,
  ): string | undefined {
    if (!oauthError) return undefined;
    // OAuth 표준: access_denied (사용자가 동의/로그인을 취소)
    if (oauthError === 'access_denied') return 'USER_CANCEL';
    return 'PKCE_VERIFY_FAIL';
  }

  private mapExceptionToErrorCode(error: unknown): string {
    if (error instanceof HttpException) {
      const resp = error.getResponse() as unknown;
      const code =
        typeof resp === 'object' && resp !== null && 'code' in resp
          ? (resp as { code?: unknown }).code
          : undefined;
      if (isPkceErrorCode(code)) return code;
    }

    // 기본값(예상치 못한 예외)
    return 'INTERNAL_ERROR';
  }

  private pickSafeErrorMessage(error: unknown): string | undefined {
    // 화이트리스트 방식: 허용된 고정 문구만 전달
    if (!(error instanceof HttpException)) return undefined;

    const resp = error.getResponse() as unknown;
    const msgCandidate = (() => {
      if (typeof resp === 'string') return resp;
      if (typeof resp === 'object' && resp !== null) {
        const anyResp = resp as { message?: unknown; error?: unknown };
        if (typeof anyResp.message === 'string') return anyResp.message;
        // Nest 기본 형태에서 message가 배열인 경우가 있음(여기선 전송 안 함)
        if (typeof anyResp.error === 'string') return anyResp.error;
      }
      return undefined;
    })();

    if (!msgCandidate) return undefined;

    const whitelist = new Set<string>([
      'PKCE state expired',
      'Invalid state - no matching PKCE data found',
      'Google PKCE verification failed',
      'Kakao PKCE verification failed',
      'Naver PKCE verification failed',
      'Google PKCE internal error',
      'Kakao PKCE internal error',
      'Naver PKCE internal error',
    ]);

    return whitelist.has(msgCandidate) ? msgCandidate : undefined;
  }

  @Post('send-verification-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '이메일 인증 코드 발송',
    description:
      '지정된 이메일 주소로 6자리 인증 코드를 발송합니다. 인증 코드는 10분간 유효합니다.',
  })
  @ApiBody({ type: SendVerificationEmailDto })
  @ApiResponse({
    status: 200,
    description: '인증 코드 발송 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (이메일 형식 오류, 재전송 시간 제한 등)',
    type: ErrorResponseDto,
  })
  async sendVerificationEmail(
    @Body() sendVerificationEmailDto: SendVerificationEmailDto,
  ) {
    try {
      await this.authService.sendVerificationEmail(sendVerificationEmailDto);
      return SuccessResponseDto.create(
        '인증코드 발송완료. 10분내 인증 필요',
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

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '이메일 인증 코드 확인',
    description:
      '발송된 6자리 인증 코드를 확인하여 이메일 인증을 완료합니다. 응답에 포함된 securityToken을 저장했다가 find-account 요청 시 사용하세요.',
  })
  @ApiBody({ type: VerifyEmailDto })
  @ApiResponse({
    status: 200,
    description: '이메일 인증 성공',
    type: SuccessResponseDto,
    schema: {
      example: {
        statusCode: 200,
        message: '이메일 인증이 완료되었습니다.',
        data: {
          isVerified: true,
          securityToken: 'base64EncodedEncryptedEmail...',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '인증 실패 (잘못된 코드, 만료된 코드, 시도 횟수 초과 등)',
    type: ErrorResponseDto,
  })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    try {
      const result = await this.authService.verifyEmail(verifyEmailDto);
      return SuccessResponseDto.create(result.message, {
        isVerified: result.isVerified,
        securityToken: result.securityToken,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.BAD_REQUEST, message),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('find-account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '계정 찾기 (이메일 인증 후)',
    description:
      'verify-email에서 받은 securityToken을 전달하여 계정의 존재 여부와 유형(소셜/자체)을 확인합니다.',
  })
  @ApiBody({ type: FindAccountRequestDto })
  @ApiResponse({
    status: 200,
    description: '계정 조회 성공',
    type: SuccessResponseDto,
    schema: {
      examples: {
        notRegistered: {
          summary: '가입되지 않은 이메일',
          value: {
            statusCode: 200,
            message: '가입되지 않은 이메일입니다. 새로 가입해주세요.',
            data: {
              isRegistered: false,
              accountType: '자체',
            },
          },
        },
        socialRegistered: {
          summary: '소셜 계정으로 가입된 이메일',
          value: {
            statusCode: 200,
            message:
              '이미 구글 계정으로 가입된 이메일입니다. 구글 로그인을 사용해주세요.',
            data: {
              isRegistered: true,
              accountType: '소셜',
            },
          },
        },
        selfRegistered: {
          summary: '자체 회원가입 계정',
          value: {
            statusCode: 200,
            message: '이미 가입된 이메일입니다. 로그인해주세요.',
            data: {
              isRegistered: true,
              accountType: '자체',
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '유효하지 않은 보안 토큰',
    type: ErrorResponseDto,
  })
  async findAccount(@Body() findAccountRequestDto: FindAccountRequestDto) {
    try {
      const result = await this.authService.findAccount(findAccountRequestDto);
      return SuccessResponseDto.create(result.message, {
        isRegistered: result.isRegistered,
        accountType: result.accountType,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.BAD_REQUEST, message),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('naver')
  @UseGuards(AuthGuard('naver'))
  naverLogin() {
    // 네이버 로그인 페이지로 리디렉션
    return SuccessResponseDto.create(
      '네이버 로그인 페이지로 리디렉션 중입니다.',
      null,
    );
  }

  @Get('kakao')
  @UseGuards(AuthGuard('kakao'))
  kakaoLogin() {
    // 카카오 로그인 페이지로 리디렉션
    return SuccessResponseDto.create(
      '카카오 로그인 페이지로 리디렉션 중입니다.',
      null,
    );
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin() {
    // 구글 로그인 페이지로 리디렉션
    return SuccessResponseDto.create(
      '구글 로그인 페이지로 리디렉션 중입니다.',
      null,
    );
  }
  /* Get google Auth Callback */
  @Get('/google/callback')
  @UseGuards(AuthGuard('google'))
  googleAuthCallback(
    @Req() req: Request,
    @Res() res: Response, // : Promise<NaverLoginAuthOutputDto>
  ) {
    const user = (req as unknown as { user?: unknown }).user;
    return res.send(user);
  }

  /* Get naver Auth Callback */
  @Get('/naver/callback')
  @UseGuards(AuthGuard('naver'))
  naverAuthCallback(
    @Req() req: Request,
    @Res() res: Response, // : Promise<NaverLoginAuthOutputDto>
  ) {
    const user = (req as unknown as { user?: unknown }).user;
    return res.send(user);
  }

  /* Get kakao Auth Callback */
  @Get('/kakao/callback')
  @UseGuards(AuthGuard('kakao'))
  kakaoAuthCallback(
    @Req() req: Request,
    @Res() res: Response, // : Promise<NaverLoginAuthOutputDto>
  ) {
    const user = (req as unknown as { user?: unknown }).user;
    return res.send(user);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '비밀번호 재설정',
    description:
      '이메일 인증 완료 후 새로운 비밀번호로 재설정합니다. 먼저 이메일 인증(/auth/send-verification-email, /auth/verify-email)을 완료해야 합니다.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({
    status: 200,
    description: '비밀번호 재설정 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (현재 비밀번호와 동일, 유효성 검사 실패 등)',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '사용자를 찾을 수 없음',
    type: ErrorResponseDto,
  })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    try {
      await this.authService.resetPassword(resetPasswordDto);
      return SuccessResponseDto.create(
        '비밀번호가 성공적으로 재설정되었습니다.',
        null,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      const statusCode = message.includes('찾을 수 없습니다')
        ? HttpStatus.NOT_FOUND
        : HttpStatus.BAD_REQUEST;
      throw new HttpException(
        ErrorResponseDto.create(statusCode, message),
        statusCode,
      );
    }
  }

  // ==================== PKCE 소셜 로그인 엔드포인트들 ====================

  @Get('google/pkce')
  @ApiOperation({
    summary: 'Google PKCE 로그인 URL 생성',
    description:
      'PKCE 방식의 Google OAuth 2.0 로그인 URL을 생성합니다. 모바일 앱에서 사용하세요.',
  })
  @ApiResponse({
    status: 200,
    description: 'Google PKCE 로그인 URL 생성 성공',
    type: SuccessResponseDto,
  })
  async getGooglePKCEUrl() {
    try {
      const result = await this.authService.getGooglePKCEAuthUrl();
      return SuccessResponseDto.create('Google PKCE 로그인 URL입니다.', result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.BAD_REQUEST, message),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('kakao/pkce')
  @ApiOperation({
    summary: 'Kakao PKCE 로그인 URL 생성',
    description:
      'PKCE 방식의 Kakao OAuth 2.0 로그인 URL을 생성합니다. 모바일 앱에서 사용하세요.',
  })
  @ApiResponse({
    status: 200,
    description: 'Kakao PKCE 로그인 URL 생성 성공',
    type: SuccessResponseDto,
  })
  async getKakaoPKCEUrl() {
    try {
      const result = await this.authService.getKakaoPKCEAuthUrl();
      return SuccessResponseDto.create('Kakao PKCE 로그인 URL입니다.', result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.BAD_REQUEST, message),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('naver/pkce')
  @ApiOperation({
    summary: 'Naver PKCE 로그인 URL 생성',
    description:
      'PKCE 방식의 Naver OAuth 2.0 로그인 URL을 생성합니다. 모바일 앱에서 사용하세요.',
  })
  @ApiResponse({
    status: 200,
    description: 'Naver PKCE 로그인 URL 생성 성공',
    type: SuccessResponseDto,
  })
  async getNaverPKCEUrl() {
    try {
      const result = await this.authService.getNaverPKCEAuthUrl();
      return SuccessResponseDto.create('Naver PKCE 로그인 URL입니다.', result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.BAD_REQUEST, message),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('google/pkce/callback')
  @ApiOperation({
    summary: 'Google PKCE 콜백 처리',
    description: 'Google OAuth 2.0 PKCE 인증 후 콜백을 처리합니다.',
  })
  async handleGooglePKCECallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
    @Query('error') oauthError?: string,
    @Query('error_description') oauthErrorDescription?: string,
  ) {
    try {
      res.set({ 'Cache-Control': 'no-store' });

      // provider가 OAuth 에러를 콜백으로 내려주는 케이스(사용자 취소/동의 거부 등)
      if (oauthError) {
        const errorCode = this.mapProviderOAuthErrorToErrorCode(oauthError);
        this.logger.warn({
          message: '[PKCE] google callback oauthError',
          provider: 'google',
          oauthError,
          oauthErrorDescription,
          stateHash: state ? this.hashForLog(state) : undefined,
        });
        return res.redirect(
          303,
          this.buildAuthResultRedirectUrl({
            status: 'error',
            provider: 'google',
            errorCode: errorCode ?? 'PKCE_VERIFY_FAIL',
          }),
        );
      }

      if (!code || !state) {
        return res.redirect(
          303,
          this.buildAuthResultRedirectUrl({
            status: 'error',
            provider: 'google',
            errorCode: 'PKCE_VERIFY_FAIL',
          }),
        );
      }

      await this.authService.handleGooglePKCECallback(code, state);

      return res.redirect(
        303,
        this.buildAuthResultRedirectUrl({
          status: 'success',
          provider: 'google',
          state,
        }),
      );
    } catch (error) {
      const errorCode = this.mapExceptionToErrorCode(error);
      const errorMessage = this.pickSafeErrorMessage(error);
      this.logger.error({
        message: '[PKCE] google callback failed',
        provider: 'google',
        errorCode,
        stateHash: state ? this.hashForLog(state) : undefined,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) },
      });
      return res.redirect(
        303,
        this.buildAuthResultRedirectUrl({
          status: 'error',
          provider: 'google',
          errorCode,
          errorMessage,
        }),
      );
    }
  }

  @Get('kakao/pkce/callback')
  @ApiOperation({
    summary: 'Kakao PKCE 콜백 처리',
    description: 'Kakao OAuth 2.0 PKCE 인증 후 콜백을 처리합니다.',
  })
  async handleKakaoPKCECallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
    @Query('error') oauthError?: string,
    @Query('error_description') oauthErrorDescription?: string,
  ) {
    try {
      res.set({ 'Cache-Control': 'no-store' });

      if (oauthError) {
        const errorCode = this.mapProviderOAuthErrorToErrorCode(oauthError);
        this.logger.warn({
          message: '[PKCE] kakao callback oauthError',
          provider: 'kakao',
          oauthError,
          oauthErrorDescription,
          stateHash: state ? this.hashForLog(state) : undefined,
        });
        return res.redirect(
          303,
          this.buildAuthResultRedirectUrl({
            status: 'error',
            provider: 'kakao',
            errorCode: errorCode ?? 'PKCE_VERIFY_FAIL',
          }),
        );
      }

      if (!code || !state) {
        return res.redirect(
          303,
          this.buildAuthResultRedirectUrl({
            status: 'error',
            provider: 'kakao',
            errorCode: 'PKCE_VERIFY_FAIL',
          }),
        );
      }

      await this.authService.handleKakaoPKCECallback(code, state);

      return res.redirect(
        303,
        this.buildAuthResultRedirectUrl({
          status: 'success',
          provider: 'kakao',
          state,
        }),
      );
    } catch (error) {
      const errorCode = this.mapExceptionToErrorCode(error);
      const errorMessage = this.pickSafeErrorMessage(error);
      this.logger.error({
        message: '[PKCE] kakao callback failed',
        provider: 'kakao',
        errorCode,
        stateHash: state ? this.hashForLog(state) : undefined,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) },
      });
      return res.redirect(
        303,
        this.buildAuthResultRedirectUrl({
          status: 'error',
          provider: 'kakao',
          errorCode,
          errorMessage,
        }),
      );
    }
  }

  @Get('naver/pkce/callback')
  @ApiOperation({
    summary: 'Naver PKCE 콜백 처리',
    description: 'Naver OAuth 2.0 PKCE 인증 후 콜백을 처리합니다.',
  })
  async handleNaverPKCECallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
    @Query('error') oauthError?: string,
    @Query('error_description') oauthErrorDescription?: string,
  ) {
    try {
      res.set({ 'Cache-Control': 'no-store' });

      if (oauthError) {
        const errorCode = this.mapProviderOAuthErrorToErrorCode(oauthError);
        this.logger.warn({
          message: '[PKCE] naver callback oauthError',
          provider: 'naver',
          oauthError,
          oauthErrorDescription,
          stateHash: state ? this.hashForLog(state) : undefined,
        });
        return res.redirect(
          303,
          this.buildAuthResultRedirectUrl({
            status: 'error',
            provider: 'naver',
            errorCode: errorCode ?? 'PKCE_VERIFY_FAIL',
          }),
        );
      }

      if (!code || !state) {
        return res.redirect(
          303,
          this.buildAuthResultRedirectUrl({
            status: 'error',
            provider: 'naver',
            errorCode: 'PKCE_VERIFY_FAIL',
          }),
        );
      }

      await this.authService.handleNaverPKCECallback(code, state);

      return res.redirect(
        303,
        this.buildAuthResultRedirectUrl({
          status: 'success',
          provider: 'naver',
          state,
        }),
      );
    } catch (error) {
      const errorCode = this.mapExceptionToErrorCode(error);
      const errorMessage = this.pickSafeErrorMessage(error);
      this.logger.error({
        message: '[PKCE] naver callback failed',
        provider: 'naver',
        errorCode,
        stateHash: state ? this.hashForLog(state) : undefined,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) },
      });
      return res.redirect(
        303,
        this.buildAuthResultRedirectUrl({
          status: 'error',
          provider: 'naver',
          errorCode,
          errorMessage,
        }),
      );
    }
  }

  @Get('check-status')
  @ApiOperation({
    summary: '소셜 로그인 상태 폴링',
    description: `프론트에서 소셜 로그인 완료 여부를 확인하기 위한 폴링 API입니다. 
    서버 부하 방지를 위해 최소 2-3초 간격으로 호출하시고, 
    clientState 파라미터를 전달하여 효율적인 상태 확인이 가능합니다.`,
  })
  @ApiResponse({
    status: 200,
    description: '상태 확인 성공',
    type: SuccessResponseDto,
    schema: {
      examples: {
        incomplete: {
          summary: '로그인 미완료',
          value: {
            statusCode: 200,
            message: '소셜 로그인이 아직 완료되지 않았습니다.',
            data: {
              state: null,
              isComplete: false,
              recommendedPollingInterval: 3000,
            },
          },
        },
        complete: {
          summary: '로그인 완료',
          value: {
            statusCode: 200,
            message: '소셜 로그인이 완료되었습니다.',
            data: {
              state: 'abc123xyz',
              isComplete: true,
              recommendedPollingInterval: 0,
            },
          },
        },
      },
    },
  })
  checkAuthStatus(
    @Res() res: Response,
    @Query('clientState') clientState?: string,
  ) {
    // 서버 부하 방지를 위한 캐시 헤더 설정
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });

    // (async) Redis 기반 조회
    return this.authService.checkAuthStatus(clientState).then((result) => {
      // 폴링 간격 권장사항 추가
      const data = {
        state: result.state,
        isComplete: result.isComplete,
        recommendedPollingInterval: result.isComplete ? 0 : 3000, // 완료되면 0, 미완료면 3초
      };

      return res.json(SuccessResponseDto.create(result.message, data));
    });
  }

  @Post('exchange-token')
  @ApiOperation({
    summary: 'codeVerifier로 토큰 교환',
    description:
      '프론트에서 codeVerifier를 사용하여 최종 JWT 토큰을 교환합니다.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        codeVerifier: { type: 'string', description: 'PKCE code verifier' },
      },
      required: ['codeVerifier'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '토큰 교환 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '토큰 교환 실패',
    type: ErrorResponseDto,
  })
  async exchangeToken(@Body('codeVerifier') codeVerifier: string) {
    if (!codeVerifier) {
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.BAD_REQUEST,
          'codeVerifier is required',
        ),
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result =
        await this.authService.exchangeTokenWithCodeVerifier(codeVerifier);
      return SuccessResponseDto.create('토큰 교환 성공', result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      throw new HttpException(
        ErrorResponseDto.create(HttpStatus.UNAUTHORIZED, message),
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  @Post('logout')
  @ApiOperation({
    summary: '로그아웃',
    description: 'HTTP-Only 쿠키를 삭제하여 로그아웃 처리합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '로그아웃 성공',
    type: SuccessResponseDto,
    schema: {
      example: {
        statusCode: 200,
        message: '로그아웃되었습니다.',
        data: null,
      },
    },
  })
  logout(@Res() res: Response) {
    // 쿠키 삭제
    res.clearCookie('accessToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });

    return res.json(SuccessResponseDto.create('로그아웃되었습니다.', null));
  }

  // ==================== 디버깅용 엔드포인트 (개발 환경 전용) ====================

  @Get('debug/states')
  @ApiOperation({
    summary: '저장된 PKCE 상태 목록 조회 (개발용)',
    description:
      '현재 서버 메모리에 저장된 PKCE 상태들을 조회합니다. 개발 환경에서만 사용하세요.',
  })
  @ApiResponse({
    status: 200,
    description: 'PKCE 상태 목록 조회 성공',
    type: SuccessResponseDto,
    schema: {
      example: {
        statusCode: 200,
        message: '현재 저장된 PKCE 상태들입니다.',
        data: {
          count: 2,
          states: [
            {
              state: 'abc123xyz',
              isComplete: true,
              expiresAt: '2024-01-15T12:00:00.000Z',
              hasUser: true,
              hasAccessToken: true,
            },
          ],
        },
      },
    },
  })
  async getDebugStates() {
    const result = await this.authService.getDebugStates();
    return SuccessResponseDto.create(result.message, {
      count: result.count,
      states: result.states,
    });
  }

  @Get('debug/states/:state')
  @ApiOperation({
    summary: '특정 PKCE 상태 상세 조회 (개발용)',
    description:
      '특정 state의 상세 정보를 조회합니다. 개발 환경에서만 사용하세요.',
  })
  @ApiResponse({
    status: 200,
    description: '특정 PKCE 상태 조회 성공',
    type: SuccessResponseDto,
    schema: {
      example: {
        statusCode: 200,
        message: '해당 state의 상세 정보입니다.',
        data: {
          exists: true,
          state: 'abc123xyz',
          isComplete: true,
          expiresAt: '2024-01-15T12:00:00.000Z',
          hasAccessToken: true,
          hasUser: true,
          userInfo: {
            email: 'user@example.com',
            name: 'Test User',
            socialProvider: 'Google',
          },
        },
      },
    },
  })
  async getDebugStateDetail(@Param('state') state: string) {
    const result = await this.authService.getDebugStateDetail(state);
    return SuccessResponseDto.create(result.message, {
      exists: result.exists,
      ...result.data,
    });
  }
}
