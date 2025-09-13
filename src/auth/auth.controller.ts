import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { 
  SendVerificationEmailDto, 
  VerifyEmailDto
} from './dto/email-verification.dto';

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
        message: '인증 코드는 1분에 한 번만 요청할 수 있습니다.',
        error: 'Bad Request'
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
        message: '인증 코드가 일치하지 않습니다. (3/5)',
        error: 'Bad Request'
      }
    }
  })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return await this.authService.verifyEmail(verifyEmailDto);
  }
}
  