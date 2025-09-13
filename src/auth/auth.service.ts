import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { SendVerificationEmailDto, VerifyEmailDto} from './dto/email-verification.dto';

// 이메일 인증 정보를 저장할 인터페이스
interface EmailVerification {
  email: string;
  code: string;
  expiresAt: Date;
  attempts: number;
}


@Injectable()
export class AuthService {
  // 실제 프로덕션에서는 Redis나 데이터베이스를 사용해야 합니다
  private verificationCodes = new Map<string, EmailVerification>();

  constructor(
    private mailService: MailService,
    private configService: ConfigService,
  ) {}

  /**
   * 이메일 인증 코드 발송
   */
  async sendVerificationEmail(sendVerificationEmailDto: SendVerificationEmailDto): Promise<{ message: string }> {
    const { email } = sendVerificationEmailDto;

    // 이메일 주소 정규화 (소문자로 변환)
    const normalizedEmail = email.toLowerCase();

    // 기존 인증 시도 확인 (1분 내 재전송 방지)
    const existingVerification = this.verificationCodes.get(normalizedEmail);
    if (existingVerification) {
      const timeDiff = Date.now() - (existingVerification.expiresAt.getTime() - 10 * 60 * 1000); // 10분 - 경과시간
      if (timeDiff < 60 * 1000) { // 1분 미만
        throw new BadRequestException('인증 코드는 1분에 한 번만 요청할 수 있습니다.');
      }
    }

    // 6자리 랜덤 인증 코드 생성
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    // 인증 정보 저장 (10분 유효)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    this.verificationCodes.set(normalizedEmail, {
      email: normalizedEmail,
      code: verificationCode,
      expiresAt,
      attempts: 0,
    });

    try {
      // 이메일 발송
      await this.mailService.sendVerificationEmail(normalizedEmail, verificationCode);

      return {
        message: '인증 코드가 이메일로 발송되었습니다. 10분 내에 인증을 완료해주세요.',
      };
    } catch (error) {
      // 이메일 발송 실패 시 저장된 인증 정보 삭제
      this.verificationCodes.delete(normalizedEmail);
      throw new BadRequestException('이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  /**
   * 이메일 인증 코드 확인
   */
  async verifyEmail(verifyEmailDto: VerifyEmailDto): Promise<{ message: string; isVerified: boolean }> {
    const { email, verificationCode } = verifyEmailDto;
    const normalizedEmail = email.toLowerCase();

    const verification = this.verificationCodes.get(normalizedEmail);

    if (!verification) {
      throw new BadRequestException('인증 코드를 먼저 요청해주세요.');
    }

    // 만료 시간 확인
    if (new Date() > verification.expiresAt) {
      this.verificationCodes.delete(normalizedEmail);
      throw new BadRequestException('인증 코드가 만료되었습니다. 새로운 코드를 요청해주세요.');
    }

    // 시도 횟수 확인 (5회 제한)
    if (verification.attempts >= 5) {
      this.verificationCodes.delete(normalizedEmail);
      throw new BadRequestException('인증 시도 횟수를 초과했습니다. 새로운 코드를 요청해주세요.');
    }

    // 인증 코드 확인
    if (verification.code !== verificationCode) {
      verification.attempts += 1;
      throw new BadRequestException(`인증 코드가 일치하지 않습니다. (${verification.attempts}/5)`);
    }

    // 인증 성공 - 저장된 정보 삭제
    this.verificationCodes.delete(normalizedEmail);

    return {
      message: '이메일 인증이 완료되었습니다.',
      isVerified: true,
    };
  }

  /**
   * 만료된 인증 코드 및 토큰 정리 (실제로는 스케줄러 사용)
   */
  private cleanupExpiredData(): void {
    const now = new Date();

    // 만료된 인증 코드 삭제
    for (const [email, verification] of this.verificationCodes.entries()) {
      if (now > verification.expiresAt) {
        this.verificationCodes.delete(email);
      }
    }

  }
}
