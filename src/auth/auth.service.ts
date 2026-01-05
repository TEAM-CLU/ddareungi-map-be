import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import {
  SendVerificationEmailDto,
  VerifyEmailDto,
  VerifyEmailResponseDto,
} from './dto/email-verification.dto';
import {
  FindAccountRequestDto,
  FindAccountResponseDto,
} from './dto/find-account.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { User } from '../user/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { CryptoService } from '../common/crypto.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import axios from 'axios';

// 이메일 인증 정보를 저장할 인터페이스
interface EmailVerification {
  email: string;
  code: string;
  expiresAt: Date;
  attempts: number;
}

type JwtPayloadWithUserId = { userId: number };

type PkceStateData = {
  codeVerifier: string;
  expiresAt: Date;
  isComplete: boolean;
  accessToken?: string;
  user?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getStringOrNumber(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function getNested(
  obj: unknown,
  ...keys: string[]
): Record<string, unknown> | undefined {
  let cur: unknown = obj;
  for (const key of keys) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return isRecord(cur) ? cur : undefined;
}

function _getUserEmailFromPkceUser(user: unknown): string | undefined {
  // google userinfo style: { email }
  const email = isRecord(user) ? getString(user.email) : undefined;
  if (email) return email;

  // naver userinfo style: { response: { email } }
  const naverResp = getNested(user, 'response');
  return naverResp ? getString(naverResp.email) : undefined;
}

function _getUserNameFromPkceUser(user: unknown): string | undefined {
  const name = isRecord(user) ? getString(user.name) : undefined;
  if (name) return name;

  const naverResp = getNested(user, 'response');
  return naverResp ? getString(naverResp.nickname) : undefined;
}

@Injectable()
export class AuthService {
  // 실제 프로덕션에서는 Redis나 데이터베이스를 사용해야 합니다
  private verificationCodes = new Map<string, EmailVerification>();
  // PKCE state별 사용자 정보 및 토큰 저장소 (codeVerifier 포함)
  private pkceStates = new Map<string, PkceStateData>();

  constructor(
    private mailService: MailService,
    private configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly cryptoService: CryptoService,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * 이메일 인증 코드 발송
   */
  async sendVerificationEmail(
    sendVerificationEmailDto: SendVerificationEmailDto,
  ): Promise<void> {
    const { email } = sendVerificationEmailDto;

    // 이메일 주소 정규화 (소문자로 변환)
    const normalizedEmail = email.toLowerCase();

    // 기존 인증 시도 확인 (1분 내 재전송 방지)
    const existingVerification = this.verificationCodes.get(normalizedEmail);
    if (existingVerification) {
      const timeDiff =
        Date.now() -
        (existingVerification.expiresAt.getTime() - 10 * 60 * 1000); // 10분 - 경과시간
      if (timeDiff < 60 * 1000) {
        // 1분 미만
        throw new BadRequestException(
          '인증 코드는 1분에 한 번만 요청할 수 있습니다.',
        );
      }
    }

    // 6자리 랜덤 인증 코드 생성
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000,
    ).toString();

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
      await this.mailService.sendVerificationEmail(
        normalizedEmail,
        verificationCode,
      );
    } catch {
      // 이메일 발송 실패 시 저장된 인증 정보 삭제
      this.verificationCodes.delete(normalizedEmail);
      throw new BadRequestException(
        '이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.',
      );
    }
  }

  /**
   * 이메일 인증 코드 확인
   */
  verifyEmail(verifyEmailDto: VerifyEmailDto): VerifyEmailResponseDto {
    const { email, verificationCode } = verifyEmailDto;
    const normalizedEmail = email.toLowerCase();

    const verification = this.verificationCodes.get(normalizedEmail);

    if (!verification) {
      throw new BadRequestException('인증 코드를 먼저 요청해주세요.');
    }

    // 만료 시간 확인
    if (new Date() > verification.expiresAt) {
      this.verificationCodes.delete(normalizedEmail);
      throw new BadRequestException(
        '인증 코드가 만료되었습니다. 새로운 코드를 요청해주세요.',
      );
    }

    // 시도 횟수 확인 (5회 제한)
    if (verification.attempts >= 5) {
      this.verificationCodes.delete(normalizedEmail);
      throw new BadRequestException(
        '인증 시도 횟수를 초과했습니다. 새로운 코드를 요청해주세요.',
      );
    }

    // 인증 코드 확인
    if (verification.code !== verificationCode) {
      verification.attempts += 1;
      throw new BadRequestException(
        `인증 코드가 일치하지 않습니다. (${verification.attempts}/5)`,
      );
    }

    // 인증 성공 - 저장된 정보 삭제
    this.verificationCodes.delete(normalizedEmail);

    // 이메일을 암호화하여 securityToken 생성
    const securityToken = this.cryptoService.encrypt(normalizedEmail);

    return {
      message: '이메일 인증이 완료되었습니다.',
      isVerified: true,
      securityToken: securityToken,
    };
  }

  async validateUserByToken(token: string): Promise<User> {
    try {
      // 토큰 검증 및 디코딩
      const decoded = this.jwtService.verify<JwtPayloadWithUserId>(token);

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
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        message: '유효하지 않은 토큰입니다.',
      });
    }
  }

  async handleNaverLogin(
    naverProfile: unknown,
  ): Promise<{ accessToken: string }> {
    const response = getNested(naverProfile, 'response');
    const socialUid = response ? getStringOrNumber(response.id) : undefined;
    const email = response ? getString(response.email) : undefined;
    const nickname = response ? getString(response.nickname) : undefined;
    const gender = response ? getString(response.gender) : undefined;
    const birthday = response ? getString(response.birthday) : undefined;
    const birthyear = response ? getString(response.birthyear) : undefined;

    // Debugging: Check if socialUid is null
    if (!socialUid) {
      console.error('Debug: socialUid is null or undefined', naverProfile);
    }

    // 1. 회원 존재 여부 확인 (socialUid 기준)
    let user = await this.userRepository.findOne({ where: { socialUid } });

    if (!user) {
      // 2. 이메일 중복 확인 (소셜 로그인도 이메일 유니크 제약 준수)
      const normalizedEmail = email ? email.toLowerCase() : null;
      if (normalizedEmail) {
        const existingEmailUser = await this.userRepository.findOne({
          where: { email: normalizedEmail },
          select: ['userId', 'socialName'],
        });

        if (existingEmailUser) {
          throw new ConflictException({
            statusCode: 409,
            message: `이미 사용 중인 이메일입니다. (기존 계정: ${existingEmailUser.socialName || '일반 회원'})`,
          });
        }
      }

      // 3. 회원가입 처리
      const randomPassword = `naver${Math.random().toString(36).slice(-20)}`;
      const passwordHash = await bcrypt.hash(randomPassword, 10);

      // Convert birthday from MM-DD format and birthyear YYYY to YYYY-MM-DD format
      const formattedBirthDate =
        birthyear && birthday ? `${birthyear}-${birthday}` : null;

      // email이 없으면 기본값 제공 (소셜 로그인에서 email이 없을 수 있음)
      const userEmail = normalizedEmail ?? `naver_${socialUid}@social.local`;

      user = this.userRepository.create({
        socialName: 'Naver',
        socialUid,
        email: userEmail,
        name: nickname ?? 'Naver User',
        gender: gender ?? 'U',
        birthDate: formattedBirthDate
          ? new Date(formattedBirthDate)
          : new Date('1970-01-01'),
        passwordHash,
        address: 'Unknown', // 네이버에서 주소를 제공하지 않을 수 있음
      });

      console.log('Creating new user:', user);
      await this.userRepository.save(user);
    }

    // 3. 로그인 처리 (lastLogin 업데이트)
    user.lastLogin = new Date();
    await this.userRepository.save(user);

    // 4. JWT 토큰 생성
    const payload = { userId: user.userId, email: user.email };
    const accessToken = this.jwtService.sign(payload);

    // 5. 유저, 토큰 반환
    return { accessToken };
  }

  async handleKakaoLogin(
    kakaoProfile: unknown,
  ): Promise<{ accessToken: string }> {
    const socialUid = isRecord(kakaoProfile)
      ? getStringOrNumber(kakaoProfile.id)
      : undefined;
    const kakaoAccount = getNested(kakaoProfile, 'kakao_account');
    const email = kakaoAccount ? getString(kakaoAccount.email) : undefined;
    const nickname =
      (kakaoAccount ? getString(kakaoAccount.nickname) : undefined) ??
      (kakaoAccount
        ? getString(getNested(kakaoAccount, 'profile')?.nickname)
        : undefined);
    const gender = kakaoAccount ? getString(kakaoAccount.gender) : undefined;
    const birthday = kakaoAccount
      ? getString(kakaoAccount.birthday)
      : undefined;
    const birthyear = kakaoAccount
      ? getString(kakaoAccount.birthyear)
      : undefined;

    // Debugging: Check if socialUid is null
    if (!socialUid) {
      console.error('Debug: socialUid is null or undefined', kakaoProfile);
    }

    // 1. 회원 존재 여부 확인 (socialUid 기준)
    let user = await this.userRepository.findOne({ where: { socialUid } });

    if (!user) {
      // 2. 이메일 중복 확인 (소셜 로그인도 이메일 유니크 제약 준수)
      const normalizedEmail = email ? email.toLowerCase() : null;
      if (normalizedEmail) {
        const existingEmailUser = await this.userRepository.findOne({
          where: { email: normalizedEmail },
          select: ['userId', 'socialName'],
        });

        if (existingEmailUser) {
          throw new ConflictException({
            statusCode: 409,
            message: `이미 사용 중인 이메일입니다. (기존 계정: ${existingEmailUser.socialName || '일반 회원'})`,
          });
        }
      }

      // 3. 회원가입 처리
      const randomPassword = `kakao${Math.random().toString(36).slice(-20)}`;
      const passwordHash = await bcrypt.hash(randomPassword, 10);

      // Convert birthday from AAAA to AA-AA format
      const formattedBirthday = birthday
        ? `${birthday.slice(0, 2)}-${birthday.slice(2)}`
        : null;
      const formattedBirthDate =
        birthyear && formattedBirthday
          ? `${birthyear}-${formattedBirthday}`
          : null;

      // email이 없으면 기본값 제공 (소셜 로그인에서 email이 없을 수 있음)
      const userEmail = normalizedEmail ?? `kakao_${socialUid}@social.local`;

      user = this.userRepository.create({
        socialName: 'Kakao',
        socialUid,
        email: userEmail,
        name: nickname ?? 'Kakao User',
        gender: gender === 'male' ? 'M' : gender === 'female' ? 'F' : 'U',
        birthDate: formattedBirthDate
          ? new Date(formattedBirthDate)
          : new Date('1970-01-01'),
        passwordHash,
        address: 'Unknown',
      });

      console.log('Creating new user:', user);
      await this.userRepository.save(user);
    }

    // 3. 로그인 처리 (lastLogin 업데이트)
    user.lastLogin = new Date();
    await this.userRepository.save(user);

    // 4. JWT 토큰 생성
    const payload = { userId: user.userId, email: user.email };
    const accessToken = this.jwtService.sign(payload);

    // 5. 유저, 토큰 반환
    return { accessToken };
  }

  async handleGoogleLogin(
    googleProfile: unknown,
  ): Promise<{ accessToken: string }> {
    const socialUid = isRecord(googleProfile)
      ? getStringOrNumber(googleProfile.id)
      : undefined;
    const email = isRecord(googleProfile)
      ? getString(googleProfile.email)
      : undefined;
    const name = isRecord(googleProfile)
      ? getString(googleProfile.name)
      : undefined;
    const gender = isRecord(googleProfile)
      ? getString(googleProfile.gender)
      : undefined;
    const birthday = isRecord(googleProfile)
      ? getString(googleProfile.birthday)
      : undefined;

    // Debugging: Check if socialUid is null
    if (!socialUid) {
      console.error('Debug: socialUid is null or undefined', googleProfile);
    }

    // 1. 회원 존재 여부 확인 (socialUid 기준)
    let user = await this.userRepository.findOne({ where: { socialUid } });

    if (!user) {
      // 2. 이메일 중복 확인 (소셜 로그인도 이메일 유니크 제약 준수)
      const normalizedEmail = email ? email.toLowerCase() : null;
      if (normalizedEmail) {
        const existingEmailUser = await this.userRepository.findOne({
          where: { email: normalizedEmail },
          select: ['userId', 'socialName'],
        });

        if (existingEmailUser) {
          throw new ConflictException({
            statusCode: 409,
            message: `이미 사용 중인 이메일입니다. (기존 계정: ${existingEmailUser.socialName || '일반 회원'})`,
          });
        }
      }

      // 3. 회원가입 처리
      const randomPassword = `google${Math.random().toString(36).slice(-20)}`;
      const passwordHash = await bcrypt.hash(randomPassword, 10);

      // 생년월일 처리 개선
      let parsedBirthDate: Date;
      if (birthday && birthday !== 'unknown') {
        try {
          parsedBirthDate = new Date(birthday);
          // 유효하지 않은 날짜인 경우 기본값 사용
          if (isNaN(parsedBirthDate.getTime())) {
            parsedBirthDate = new Date('1970-01-01');
          }
        } catch {
          parsedBirthDate = new Date('1970-01-01');
        }
      } else {
        parsedBirthDate = new Date('1970-01-01');
      }

      // email이 없으면 기본값 제공 (소셜 로그인에서 email이 없을 수 있음)
      const userEmail = normalizedEmail ?? `google_${socialUid}@social.local`;

      user = this.userRepository.create({
        socialName: 'Google',
        socialUid,
        email: userEmail,
        name: name ?? 'Google User',
        gender: gender || 'U', // Unknown으로 기본값 설정
        birthDate: parsedBirthDate,
        passwordHash,
        address: 'Unknown',
      });

      console.log('Creating new user:', user);
      await this.userRepository.save(user);
    }

    // 3. 로그인 처리 (lastLogin 업데이트)
    user.lastLogin = new Date();
    await this.userRepository.save(user);

    // 4. JWT 토큰 생성
    const payload = { userId: user.userId, email: user.email };
    const accessToken = this.jwtService.sign(payload);

    // 5. 유저, 토큰 반환
    return { accessToken };
  }

  /**
   * 비밀번호 재설정 (이메일 인증 완료 후 호출)
   */
  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<void> {
    const { email, newPassword } = resetPasswordDto;
    const normalizedEmail = email.toLowerCase();

    // 1. 사용자 존재 여부 확인
    const user = await this.userRepository.findOne({
      where: { email: normalizedEmail },
      select: ['userId', 'email', 'passwordHash'],
    });

    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        message: '해당 이메일로 등록된 사용자를 찾을 수 없습니다.',
      });
    }

    // 2. 새로운 비밀번호가 기존 비밀번호와 같은지 확인
    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      throw new BadRequestException({
        statusCode: 400,
        message:
          '현재 사용 중인 비밀번호와 동일합니다. 다른 비밀번호를 입력해주세요.',
      });
    }

    // 3. 새로운 비밀번호 해싱
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // 4. 비밀번호 업데이트 (updatedAt은 @UpdateDateColumn으로 자동 업데이트됨)
    await this.userRepository.update(user.userId, {
      passwordHash: hashedNewPassword,
    });
  }

  // ==================== PKCE 관련 메서드들 ====================

  /**
   * PKCE용 code_verifier와 code_challenge 생성
   */
  generatePKCE() {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return {
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: 'S256',
    };
  }

  /**
   * Google PKCE 로그인 URL 생성
   */
  getGooglePKCEAuthUrl() {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const redirectUri = this.configService.get<string>(
      'GOOGLE_PKCE_CALLBACK_URL',
    );
    if (!redirectUri) {
      throw new BadRequestException(
        'GOOGLE_PKCE_CALLBACK_URL 환경변수가 설정되지 않았습니다.',
      );
    }

    const pkce = this.generatePKCE();
    const state = crypto.randomBytes(16).toString('base64url');

    // state와 codeVerifier 매핑 저장 (초기 상태)
    this.pkceStates.set(state, {
      accessToken: '', // 콜백에서 채워질 예정
      user: null, // 콜백에서 채워질 예정
      codeVerifier: pkce.codeVerifier,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10분
      isComplete: false, // 초기 상태는 미완료
    });

    const baseUrl = 'https://accounts.google.com/o/oauth2/auth';
    const params = new URLSearchParams();
    params.append('client_id', clientId!);
    params.append('redirect_uri', redirectUri);
    params.append('response_type', 'code');
    params.append('scope', 'openid email profile');
    params.append('code_challenge', pkce.codeChallenge);
    params.append('code_challenge_method', pkce.codeChallengeMethod);
    params.append('state', state);

    return {
      authUrl: `${baseUrl}?${params.toString()}`,
      codeVerifier: pkce.codeVerifier,
      state: state,
    };
  }

  /**
   * Kakao PKCE 로그인 URL 생성
   */
  getKakaoPKCEAuthUrl() {
    const clientId = this.configService.get<string>('KAKAO_CLIENT_ID');
    const redirectUri = this.configService.get<string>(
      'KAKAO_PKCE_CALLBACK_URL',
    );
    if (!redirectUri) {
      throw new BadRequestException(
        'KAKAO_PKCE_CALLBACK_URL 환경변수가 설정되지 않았습니다.',
      );
    }

    const pkce = this.generatePKCE();
    const state = crypto.randomBytes(16).toString('base64url');

    // state와 codeVerifier 매핑 저장 (초기 상태)
    this.pkceStates.set(state, {
      accessToken: '', // 콜백에서 채워질 예정
      user: null, // 콜백에서 채워질 예정
      codeVerifier: pkce.codeVerifier,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10분
      isComplete: false, // 초기 상태는 미완료
    });

    const baseUrl = 'https://kauth.kakao.com/oauth/authorize';
    const params = new URLSearchParams();
    params.append('client_id', clientId!);
    params.append('redirect_uri', redirectUri);
    params.append('response_type', 'code');
    params.append('code_challenge', pkce.codeChallenge);
    params.append('code_challenge_method', pkce.codeChallengeMethod);
    params.append('state', state);

    return {
      authUrl: `${baseUrl}?${params.toString()}`,
      codeVerifier: pkce.codeVerifier,
      state: state,
    };
  }

  /**
   * Naver PKCE 로그인 URL 생성
   */
  getNaverPKCEAuthUrl() {
    const clientId = this.configService.get<string>('NAVER_CLIENT_ID');
    const redirectUri = this.configService.get<string>(
      'NAVER_PKCE_CALLBACK_URL',
    );
    if (!redirectUri) {
      throw new BadRequestException(
        'NAVER_PKCE_CALLBACK_URL 환경변수가 설정되지 않았습니다.',
      );
    }

    const pkce = this.generatePKCE();
    const state = crypto.randomBytes(16).toString('base64url');

    // state와 codeVerifier 매핑 저장 (초기 상태)
    this.pkceStates.set(state, {
      accessToken: '', // 콜백에서 채워질 예정
      user: null, // 콜백에서 채워질 예정
      codeVerifier: pkce.codeVerifier,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10분
      isComplete: false, // 초기 상태는 미완료
    });

    const baseUrl = 'https://nid.naver.com/oauth2.0/authorize';
    const params = new URLSearchParams();
    params.append('client_id', clientId!);
    params.append('redirect_uri', redirectUri);
    params.append('response_type', 'code');
    params.append('code_challenge', pkce.codeChallenge);
    params.append('code_challenge_method', pkce.codeChallengeMethod);
    params.append('state', state);

    return {
      authUrl: `${baseUrl}?${params.toString()}`,
      codeVerifier: pkce.codeVerifier,
      state: state,
    };
  }

  /**
   * Google PKCE 콜백 처리 - 사용자 정보 저장하고 state 반환
   */
  async handleGooglePKCECallback(code: string, state: string): Promise<string> {
    try {
      // 0. 기존 state 데이터에서 code_verifier 조회
      const existingPkceData = this.pkceStates.get(state);
      if (!existingPkceData) {
        throw new UnauthorizedException(
          'Invalid state - no matching PKCE data found',
        );
      }

      // 1. Access Token 요청 (저장된 code_verifier 사용)
      const tokenResponse = await axios.post(
        'https://oauth2.googleapis.com/token',
        {
          client_id: this.configService.get<string>('GOOGLE_CLIENT_ID'),
          client_secret: this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
          code: code,
          code_verifier: existingPkceData.codeVerifier, // 저장된 code_verifier 사용
          grant_type: 'authorization_code',
          redirect_uri:
            this.configService.get<string>('GOOGLE_PKCE_CALLBACK_URL') ||
            'http://localhost:3000/auth/google/pkce/callback',
        },
      );

      const access_token = getString(
        (tokenResponse.data as unknown as Record<string, unknown>)[
          'access_token'
        ],
      );
      if (!access_token) {
        throw new BadRequestException(
          'Google access_token을 가져오지 못했습니다.',
        );
      }

      // 2. 사용자 정보 가져오기
      const userResponse = await axios.get(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        },
      );

      // 3. 추가 정보 가져오기 (생일, 성별)
      const peopleResponse = await axios.get(
        'https://people.googleapis.com/v1/people/me?personFields=birthdays,genders',
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        },
      );

      const userData = userResponse.data as unknown as Record<string, unknown>;
      const peopleData = peopleResponse.data as unknown as Record<
        string,
        unknown
      >;

      const id = getStringOrNumber(userData['id']);
      const name = getString(userData['name']);
      const email = getString(userData['email']);

      // genders?.[0]?.value
      const genders = peopleData['genders'] as Array<Record<string, unknown>>;
      const genderValue = Array.isArray(genders)
        ? getString(genders[0]?.value)
        : undefined;
      const gender =
        genderValue === 'male' ? 'M' : genderValue === 'female' ? 'F' : 'U';

      // birthdays?.[0]?.date { year, month, day }
      const birthdays = peopleData['birthdays'] as Array<
        Record<string, unknown>
      >;
      const firstBirthday = Array.isArray(birthdays) ? birthdays[0] : undefined;
      const dateObj = firstBirthday
        ? getNested(firstBirthday, 'date')
        : undefined;
      const year = dateObj ? dateObj['year'] : undefined;
      const month = dateObj ? dateObj['month'] : undefined;
      const day = dateObj ? dateObj['day'] : undefined;
      const birthday =
        typeof year === 'number' &&
        typeof month === 'number' &&
        typeof day === 'number'
          ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          : null;

      const googleProfile = { id, name, email, gender, birthday };

      // 4. 회원가입/로그인 처리
      const authResult = await this.handleGoogleLogin(googleProfile);

      // 5. 기존 state 데이터 업데이트 (codeVerifier 유지, 로그인 완료 표시)
      this.pkceStates.set(state, {
        accessToken: authResult.accessToken,
        user: googleProfile,
        codeVerifier: existingPkceData.codeVerifier, // 기존 codeVerifier 유지
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5분으로 갱신
        isComplete: true, // 로그인 완료
      });

      // 7. state 반환 (딥링크에 사용)
      return state;
    } catch (error) {
      console.error('Google PKCE callback error:', error);
      throw new BadRequestException(
        'Google 로그인 처리 중 오류가 발생했습니다.',
      );
    }
  }
  /**
   * Kakao PKCE 콜백 처리 - 사용자 정보 저장하고 state 반환
   */
  async handleKakaoPKCECallback(code: string, state: string): Promise<string> {
    try {
      // 0. 기존 state 데이터에서 code_verifier 조회
      const existingPkceData = this.pkceStates.get(state);
      if (!existingPkceData) {
        throw new UnauthorizedException(
          'Invalid state - no matching PKCE data found',
        );
      }

      // 1. Access Token 요청 (저장된 code_verifier 사용)
      const tokenResponse = await axios.post(
        'https://kauth.kakao.com/oauth/token',
        {
          grant_type: 'authorization_code',
          client_id: this.configService.get<string>('KAKAO_CLIENT_ID'),
          client_secret: this.configService.get<string>('KAKAO_CLIENT_SECRET'),
          code: code,
          code_verifier: existingPkceData.codeVerifier, // 저장된 code_verifier 사용
          redirect_uri:
            this.configService.get<string>('KAKAO_PKCE_CALLBACK_URL') ||
            'http://localhost:3000/auth/kakao/pkce/callback',
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      const access_token = getString(
        (tokenResponse.data as unknown as Record<string, unknown>)[
          'access_token'
        ],
      );
      if (!access_token) {
        throw new BadRequestException(
          'Kakao access_token을 가져오지 못했습니다.',
        );
      }

      // 2. 사용자 정보 가져오기
      const userResponse = await axios.get(
        'https://kapi.kakao.com/v2/user/me',
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        },
      );

      const kakaoProfile = userResponse.data as unknown;

      // 3. 회원가입/로그인 처리
      const authResult = await this.handleKakaoLogin(kakaoProfile);

      // 4. 기존 state 데이터 업데이트 (codeVerifier 유지, 로그인 완료 표시)
      this.pkceStates.set(state, {
        accessToken: authResult.accessToken,
        user: kakaoProfile,
        codeVerifier: existingPkceData.codeVerifier, // 기존 codeVerifier 유지
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5분으로 갱신
        isComplete: true, // 로그인 완료
      });

      // 5. state 반환 (딥링크에 사용)
      return state;
    } catch (error) {
      console.error('Kakao PKCE callback error:', error);
      throw new BadRequestException(
        '카카오 로그인 처리 중 오류가 발생했습니다.',
      );
    }
  }

  /**
   * Naver PKCE 콜백 처리 - 사용자 정보 저장하고 state 반환
   */
  async handleNaverPKCECallback(code: string, state: string): Promise<string> {
    try {
      // 0. 기존 state 데이터에서 code_verifier 조회
      const existingPkceData = this.pkceStates.get(state);
      if (!existingPkceData) {
        throw new UnauthorizedException(
          'Invalid state - no matching PKCE data found',
        );
      }

      // 1. Access Token 요청 (저장된 code_verifier 사용)
      const tokenResponse = await axios.post(
        'https://nid.naver.com/oauth2.0/token',
        {
          grant_type: 'authorization_code',
          client_id: this.configService.get<string>('NAVER_CLIENT_ID'),
          client_secret: this.configService.get<string>('NAVER_CLIENT_SECRET'),
          code: code,
          code_verifier: existingPkceData.codeVerifier, // 저장된 code_verifier 사용
          redirect_uri:
            this.configService.get<string>('NAVER_PKCE_CALLBACK_URL') ||
            'http://localhost:3000/auth/naver/pkce/callback',
          state: state,
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      const access_token = getString(
        (tokenResponse.data as unknown as Record<string, unknown>)[
          'access_token'
        ],
      );
      if (!access_token) {
        throw new BadRequestException(
          'Naver access_token을 가져오지 못했습니다.',
        );
      }

      // 2. 사용자 정보 가져오기
      const userResponse = await axios.get(
        'https://openapi.naver.com/v1/nid/me',
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        },
      );

      const naverProfile = userResponse.data as unknown;

      // 3. 회원가입/로그인 처리
      const authResult = await this.handleNaverLogin(naverProfile);

      // 4. 기존 state 데이터 업데이트 (codeVerifier 유지, 로그인 완료 표시)
      this.pkceStates.set(state, {
        accessToken: authResult.accessToken,
        user: naverProfile,
        codeVerifier: existingPkceData.codeVerifier, // 기존 codeVerifier 유지
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5분으로 갱신
        isComplete: true, // 로그인 완료
      });

      // 5. state 반환 (딥링크에 사용)
      return state;
    } catch (error) {
      console.error('Naver PKCE callback error:', error);
      throw new BadRequestException(
        '네이버 로그인 처리 중 오류가 발생했습니다.',
      );
    }
  }

  // 🔐 codeVerifier 검증으로 토큰 반환
  exchangeTokenWithCodeVerifier(codeVerifier: string): { accessToken: string } {
    try {
      // 모든 state를 순회하여 일치하는 codeVerifier 찾기
      let matchingState: string | null = null;
      let matchingData: PkceStateData | null = null;

      for (const [state, pkceData] of this.pkceStates.entries()) {
        // 만료 확인
        if (pkceData.expiresAt < new Date()) {
          this.pkceStates.delete(state);
          continue;
        }

        // codeVerifier 일치 확인
        if (pkceData.codeVerifier === codeVerifier) {
          matchingState = state;
          matchingData = pkceData;
          break;
        }
      }

      if (!matchingData || !matchingState) {
        throw new UnauthorizedException('Invalid or expired code verifier');
      }

      // 로그인이 완료되지 않은 경우
      if (!matchingData.isComplete || !matchingData.accessToken) {
        throw new UnauthorizedException('Social login not completed yet');
      }

      // 토큰 반환 데이터 저장
      const result = {
        accessToken: matchingData.accessToken, // 우리 서비스 JWT 토큰
      };

      // 성공적으로 토큰을 교환했으므로 state 삭제
      this.pkceStates.delete(matchingState);

      return result;
    } catch (error: unknown) {
      console.error('Token exchange error:', error);
      throw new UnauthorizedException('토큰 교환에 실패했습니다.');
    }
  }

  // 🔐 쿠키 기반 토큰 검증 및 사용자 정보 조회
  async verifyTokenFromCookie(
    token: string,
  ): Promise<{ userId: number; email: string; name: string }> {
    try {
      // JWT 토큰 검증
      const payload = this.jwtService.verify<JwtPayloadWithUserId>(token);

      // 사용자 정보 조회
      const user = await this.userRepository.findOne({
        where: { userId: payload.userId },
      });

      if (!user) {
        throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
      }

      return {
        userId: user.userId,
        email: user.email,
        name: user.name,
      };
    } catch (error: unknown) {
      const errName =
        typeof error === 'object' && error !== null && 'name' in error
          ? String((error as { name?: unknown }).name)
          : '';
      if (errName === 'TokenExpiredError') {
        throw new UnauthorizedException('토큰이 만료되었습니다.');
      } else if (errName === 'JsonWebTokenError') {
        throw new UnauthorizedException('유효하지 않은 토큰입니다.');
      }
      throw new UnauthorizedException('토큰 검증에 실패했습니다.');
    }
  }

  // 🔄 폴링 API - 소셜 로그인 완료 상태 확인
  checkAuthStatus(clientState?: string): {
    state: string | null;
    isComplete: boolean;
    message: string;
  } {
    // 만료된 데이터 정리
    this.cleanupExpiredAuthData();

    // 특정 clientState가 제공된 경우 해당 state만 확인
    if (clientState) {
      const pkceData = this.pkceStates.get(clientState);

      if (!pkceData) {
        return {
          state: null,
          isComplete: false,
          message: '해당 상태를 찾을 수 없거나 만료되었습니다.',
        };
      }

      if (pkceData.expiresAt < new Date()) {
        this.pkceStates.delete(clientState);
        return {
          state: null,
          isComplete: false,
          message: '상태가 만료되었습니다.',
        };
      }

      if (pkceData.isComplete) {
        return {
          state: clientState,
          isComplete: true,
          message: '소셜 로그인이 완료되었습니다.',
        };
      } else {
        return {
          state: null,
          isComplete: false,
          message: '소셜 로그인이 아직 완료되지 않았습니다.',
        };
      }
    }

    // clientState가 없는 경우, 완료된 state가 있는지 확인
    for (const [state, data] of this.pkceStates.entries()) {
      if (data.isComplete && data.expiresAt > new Date()) {
        return {
          state: state,
          isComplete: true,
          message: '소셜 로그인이 완료되었습니다.',
        };
      }
    }

    return {
      state: null,
      isComplete: false,
      message: '진행 중인 소셜 로그인이 없거나 아직 완료되지 않았습니다.',
    };
  }

  // 만료된 인증 데이터 정리
  private cleanupExpiredAuthData(): void {
    const now = new Date();

    // 만료된 인증 코드 삭제
    for (const [email, verification] of this.verificationCodes.entries()) {
      if (now > verification.expiresAt) {
        this.verificationCodes.delete(email);
      }
    }

    // 만료된 PKCE 상태 삭제
    for (const [state, data] of this.pkceStates.entries()) {
      if (now > data.expiresAt) {
        this.pkceStates.delete(state);
      }
    }
  }

  // ==================== 디버깅용 메서드들 ====================

  /**
   * 저장된 PKCE 상태들을 조회 (디버깅용)
   */
  getDebugStates(): {
    message: string;
    count: number;
    states: Array<{
      state: string;
      isComplete: boolean;
      expiresAt: Date;
      hasUser: boolean;
      hasAccessToken: boolean;
      userEmail?: string;
    }>;
    verificationCodes: Array<{
      email: string;
      expiresAt: Date;
      attempts: number;
    }>;
  } {
    // 만료된 데이터 먼저 정리
    this.cleanupExpiredAuthData();

    const statesList: Array<{
      state: string;
      isComplete: boolean;
      expiresAt: Date;
      hasUser: boolean;
      hasAccessToken: boolean;
      userEmail?: string;
    }> = [];

    for (const [state, data] of this.pkceStates.entries()) {
      const userEmail = _getUserEmailFromPkceUser(data.user);
      statesList.push({
        state: state,
        isComplete: data.isComplete,
        expiresAt: data.expiresAt,
        hasUser: !!data.user,
        hasAccessToken: !!data.accessToken,
        userEmail: userEmail ?? undefined,
      });
    }

    const verificationsList: Array<{
      email: string;
      expiresAt: Date;
      attempts: number;
    }> = [];

    for (const [_email, verification] of this.verificationCodes.entries()) {
      verificationsList.push({
        email: verification.email,
        expiresAt: verification.expiresAt,
        attempts: verification.attempts,
      });
    }

    return {
      message: '현재 저장된 PKCE 상태들과 인증 코드들입니다.',
      count: statesList.length,
      states: statesList,
      verificationCodes: verificationsList,
    };
  }

  // ==================== 계정 찾기 엔드포인트 ====================

  /**
   * 이메일 인증 후 계정 찾기 (회원가입 여부 & 계정 유형 확인)
   */
  async findAccount(
    findAccountRequestDto: FindAccountRequestDto,
  ): Promise<FindAccountResponseDto> {
    try {
      // 1. securityToken 복호화하여 이메일 추출
      const email = this.cryptoService.decrypt(
        findAccountRequestDto.securityToken,
      );
      const normalizedEmail = email.toLowerCase();

      // 2. DB에서 이메일로 사용자 조회
      const user = await this.userRepository.findOne({
        where: { email: normalizedEmail },
        select: ['userId', 'email', 'socialName', 'socialUid', 'name'],
      });

      // 사용자가 없는 경우
      if (!user) {
        return {
          isRegistered: false,
          accountType: '자체',
          message: '가입되지 않은 이메일입니다. 새로 가입해주세요.',
        };
      }

      // 3. 사용자가 있는 경우 - 회원 유형 판별
      const isSocialAccount = !!user.socialName && !!user.socialUid;

      if (isSocialAccount) {
        return {
          isRegistered: true,
          accountType: '소셜',
          message: `이미 ${user.socialName} 계정으로 가입된 이메일입니다. ${user.socialName} 로그인을 사용해주세요.`,
        };
      } else {
        return {
          isRegistered: true,
          accountType: '자체',
          message: '이미 가입된 이메일입니다. 로그인해주세요.',
        };
      }
    } catch {
      // 복호화 실패 또는 기타 에러
      throw new BadRequestException(
        '유효하지 않은 보안 토큰입니다. 이메일 인증을 다시 진행해주세요.',
      );
    }
  }

  /**
   * 특정 state의 상세 정보 조회 (디버깅용)
   */
  getDebugStateDetail(state: string): {
    message: string;
    exists: boolean;
    data?: {
      state: string;
      isComplete: boolean;
      expiresAt: Date;
      hasAccessToken: boolean;
      hasUser: boolean;
      userInfo: null | {
        email?: string;
        name?: string;
        socialProvider?: string;
      };
    };
  } {
    const pkceData = this.pkceStates.get(state);

    if (!pkceData) {
      return {
        message: '해당 state를 찾을 수 없습니다.',
        exists: false,
      };
    }

    // 만료 확인
    if (pkceData.expiresAt < new Date()) {
      this.pkceStates.delete(state);
      return {
        message: '해당 state는 만료되어 삭제되었습니다.',
        exists: false,
      };
    }

    const email = _getUserEmailFromPkceUser(pkceData.user);
    const name = _getUserNameFromPkceUser(pkceData.user);
    const socialProvider = isRecord(pkceData.user)
      ? getString(pkceData.user.socialName)
      : undefined;

    return {
      message: '해당 state의 상세 정보입니다.',
      exists: true,
      data: {
        state: state,
        isComplete: pkceData.isComplete,
        expiresAt: pkceData.expiresAt,
        hasAccessToken: !!pkceData.accessToken,
        hasUser: !!pkceData.user,
        userInfo: pkceData.user
          ? {
              email,
              name,
              socialProvider: socialProvider ?? 'Unknown',
            }
          : null,
      },
    };
  }
}
