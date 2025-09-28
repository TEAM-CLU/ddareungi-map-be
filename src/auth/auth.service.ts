import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { SendVerificationEmailDto, VerifyEmailDto} from './dto/email-verification.dto';
import { User } from '../user/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

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
    private readonly jwtService: JwtService,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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

  async validateUserByToken(token: string): Promise<User> {
    try {
      // 토큰 검증 및 디코딩
      const decoded = this.jwtService.verify(token);

      // 디코딩된 정보에서 사용자 ID 추출
      const userId = decoded.userId;

      // 사용자 조회
      const user = await this.userRepository.findOne({ where: { userId } });
      if (!user) {
        throw new UnauthorizedException({
          statusCode: 401,
          message: '유효하지 않은 사용자입니다.',
        });
      }

      return user;
    } catch (error) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: '유효하지 않은 토큰입니다.',
      });
    }
  }

  async handleNaverLogin(naverProfile: any) {
    const { response: { id: socialUid, email, nickname, gender, birthday, birthyear, mobile } } = naverProfile;

    // Debugging: Check if socialUid is null
    if (!socialUid) {
      console.error('Debug: socialUid is null or undefined', naverProfile);
    }

    // 1. 회원 존재 여부 확인
    let user = await this.userRepository.findOne({ where: { socialUid } });

    if (!user) {
      // 2. 회원가입 처리
      const randomPassword = `naver${Math.random().toString(36).slice(-20)}`;
      const passwordHash = await bcrypt.hash(randomPassword, 10);

      // Convert birthday from MM-DD format and birthyear YYYY to YYYY-MM-DD format
      const formattedBirthDate = birthyear && birthday ? `${birthyear}-${birthday}` : null;

      // Format mobile number from +82 10-AAAA-AAAA to 010-AAAA-AAAA
      const formattedMobile = mobile && mobile.startsWith('+82')
        ? mobile.replace('+82 ', '0')
        : mobile;

      user = this.userRepository.create({
        socialName: 'Naver',
        socialUid,
        email,
        name: nickname ? nickname : 'Naver User',
        gender,
        birthDate: formattedBirthDate ? new Date(formattedBirthDate) : new Date('1970-01-01'),
        phoneNumber: formattedMobile ? formattedMobile : "Unknown", // 네이버에서 전화번호를 제공하지 않을 수 있음
        passwordHash,
      });

      console.log("Creating new user:", user);
      await this.userRepository.save(user);
    }

    // 3. 로그인 처리 (lastLogin 업데이트)
    user.lastLogin = new Date();
    await this.userRepository.save(user);

    // 4. JWT 토큰 생성
    const payload = { userId: user.userId, email: user.email };
    const accessToken = this.jwtService.sign(payload);

    // 5. 유저, 토큰 반환
    return { user, accessToken };
  }

  async handleKakaoLogin(kakaoProfile: any) {
    const { id: socialUid, kakao_account: { email, nickname, gender, birthday, birthyear, phone_number } } = kakaoProfile;

    // Debugging: Check if socialUid is null
    if (!socialUid) {
      console.error('Debug: socialUid is null or undefined', kakaoProfile);
    }

    // 1. 회원 존재 여부 확인
    let user = await this.userRepository.findOne({ where: { socialUid } });

    if (!user) {
      // 2. 회원가입 처리
      const randomPassword = `kakao${Math.random().toString(36).slice(-20)}`;
      const passwordHash = await bcrypt.hash(randomPassword, 10);

      // Convert birthday from AAAA to AA-AA format
      const formattedBirthday = birthday ? `${birthday.slice(0, 2)}-${birthday.slice(2)}` : null;
      const formattedBirthDate = birthyear && formattedBirthday ? `${birthyear}-${formattedBirthday}` : null;

      // Format mobile number from +82 10-AAAA-AAAA to 010-AAAA-AAAA
      const formattedMobile = phone_number && phone_number.startsWith('+82')
        ? phone_number.replace('+82 ', '0')
        : phone_number;

      user = this.userRepository.create({
        socialName: 'Kakao',
        socialUid,
        email,
        name: nickname ? nickname : 'Kakao User',
        gender: gender === 'male' ? 'M' : 'F',
        birthDate: formattedBirthDate ? new Date(formattedBirthDate) : new Date('1970-01-01'),
        phoneNumber: formattedMobile ? formattedMobile : "Unknown", // 카카오에서 전화번호를 제공하지 않을 수 있음
        passwordHash,
      });

      console.log("Creating new user:", user);
      await this.userRepository.save(user);
    }

    // 3. 로그인 처리 (lastLogin 업데이트)
    user.lastLogin = new Date();
    await this.userRepository.save(user);

    // 4. JWT 토큰 생성
    const payload = { userId: user.userId, email: user.email };
    const accessToken = this.jwtService.sign(payload);

    // 5. 유저, 토큰 반환
    return { user, accessToken };
  }

  async handleGoogleLogin(googleProfile: any) {
    const { id: socialUid, email, name, gender, birthday } = googleProfile;

    // Debugging: Check if socialUid is null
    if (!socialUid) {
      console.error('Debug: socialUid is null or undefined', googleProfile);
    }

    // 1. 회원 존재 여부 확인
    let user = await this.userRepository.findOne({ where: { socialUid } });

    if (!user) {
      // 2. 회원가입 처리
      const randomPassword = `google${Math.random().toString(36).slice(-20)}`;
      const passwordHash = await bcrypt.hash(randomPassword, 10);

      user = this.userRepository.create({
        socialName: 'Google',
        socialUid,
        email,
        name: name ? name : 'Google User',
        gender,
        birthDate: birthday ,
        phoneNumber: "Unknown", // 구글에서 전화번호를 제공하지 않을 수 있음
        passwordHash,
      });

      console.log("Creating new user:", user);
      // await this.userRepository.save(user);
    }

    // 3. 로그인 처리 (lastLogin 업데이트)
    user.lastLogin = new Date();
    await this.userRepository.save(user);

    // 4. JWT 토큰 생성
    const payload = { userId: user.userId, email: user.email };
    const accessToken = this.jwtService.sign(payload);

    // 5. 유저, 토큰 반환
    return { user, accessToken };
  }
  

}
