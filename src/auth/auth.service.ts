import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';
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
import { UserStats } from '../user/entities/user-stats.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { CryptoService } from '../common/crypto.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import axios from 'axios';
import type { PkceErrorCode } from './pkce-error-code';

// 이메일 인증 정보를 저장할 인터페이스
interface EmailVerification {
  email: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

type JwtPayloadWithUserId = { userId: number };

type PkceStateData = {
  codeVerifier: string;
  expiresAt: number;
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

const PKCE_STATE_KEY_PREFIX = 'pkce:state:';
const PKCE_VERIFIER_KEY_PREFIX = 'pkce:verifier:';
const EMAIL_VERIFY_KEY_PREFIX = 'verify:email:';

const PKCE_TTL_INITIAL_SECONDS = 60 * 10; // 10분
const PKCE_TTL_AFTER_CALLBACK_SECONDS = 60 * 5; // 5분
const EMAIL_VERIFY_TTL_SECONDS = 60 * 10; // 10분
const EMAIL_VERIFY_RESEND_COOLDOWN_MS = 60 * 1000; // 1분

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

@Injectable()
export class AuthService {
  private readonly redis: Redis;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private mailService: MailService,
    private configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly cryptoService: CryptoService,
    private readonly redisService: RedisService,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserStats)
    private readonly userStatsRepository: Repository<UserStats>,
  ) {
    this.redis = this.redisService.getOrThrow();
  }

  private async ensureUserStatsExists(
    userId: number,
    flow: 'naver' | 'kakao' | 'google',
  ): Promise<void> {
    try {
      await this.userStatsRepository
        .createQueryBuilder()
        .insert()
        .into(UserStats)
        .values({ userId })
        .orIgnore()
        .execute();
    } catch (error) {
      this.logger.error({
        message: '[UserStats] failed to ensure user_stats on signup',
        flow,
        userId,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) },
      });
    }
  }

  private pkceStateKey(state: string): string {
    return `${PKCE_STATE_KEY_PREFIX}${state}`;
  }

  private pkceVerifierKey(codeVerifier: string): string {
    return `${PKCE_VERIFIER_KEY_PREFIX}${codeVerifier}`;
  }

  private emailVerifyKey(normalizedEmail: string): string {
    return `${EMAIL_VERIFY_KEY_PREFIX}${normalizedEmail}`;
  }

  private hashForLog(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
  }

  private normalizeGender(raw?: string): 'M' | 'F' | null {
    if (!raw) return null;
    const v = raw.toLowerCase();
    if (v === 'm' || v === 'male') return 'M';
    if (v === 'f' || v === 'female') return 'F';
    if (v === 'u' || v === 'unknown') return null;
    return null;
  }

  private normalizeBirthYear(raw?: string | null): string | null {
    if (!raw) return null;
    return /^\d{4}$/.test(raw) ? raw : null;
  }

  private logPkceError(params: {
    provider: 'google' | 'kakao' | 'naver';
    stage: string;
    errorCode: PkceErrorCode;
    state?: string;
    code?: string;
    error: unknown;
  }): void {
    const errorObj =
      params.error instanceof Error
        ? params.error
        : new Error(String(params.error));

    this.logger.error({
      message: `[PKCE] ${params.provider} ${params.stage} failed (${params.errorCode})`,
      provider: params.provider,
      stage: params.stage,
      errorCode: params.errorCode,
      stateHash: params.state ? this.hashForLog(params.state) : undefined,
      codeHash: params.code ? this.hashForLog(params.code) : undefined,
      error: {
        name: errorObj.name,
        message: errorObj.message,
        stack: errorObj.stack,
      },
    });
  }

  /**
   * 이메일 인증 코드 발송
   */
  async sendVerificationEmail(
    sendVerificationEmailDto: SendVerificationEmailDto,
  ): Promise<void> {
    const { email } = sendVerificationEmailDto;

    // 이메일 주소 정규화 (소문자로 변환)
    const normalizedEmail = email.toLowerCase();
    const key = this.emailVerifyKey(normalizedEmail);

    // 기존 인증 시도 확인 (1분 내 재전송 방지)
    const existingRaw = await this.redis.get(key);
    const existingVerification = existingRaw
      ? safeJsonParse<EmailVerification>(existingRaw)
      : null;
    if (existingVerification) {
      const timeDiff = Date.now() - existingVerification.createdAt;
      if (timeDiff < EMAIL_VERIFY_RESEND_COOLDOWN_MS) {
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
    const createdAt = Date.now();
    const expiresAt = createdAt + EMAIL_VERIFY_TTL_SECONDS * 1000;
    const verification: EmailVerification = {
      email: normalizedEmail,
      code: verificationCode,
      createdAt,
      expiresAt,
      attempts: 0,
    };

    await this.redis.setex(
      key,
      EMAIL_VERIFY_TTL_SECONDS,
      JSON.stringify(verification),
    );

    try {
      // 이메일 발송
      await this.mailService.sendVerificationEmail(
        normalizedEmail,
        verificationCode,
      );
    } catch {
      // 이메일 발송 실패 시 저장된 인증 정보 삭제
      await this.redis.del(key);
      throw new BadRequestException(
        '이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.',
      );
    }
  }

  /**
   * 이메일 인증 코드 확인
   */
  async verifyEmail(
    verifyEmailDto: VerifyEmailDto,
  ): Promise<VerifyEmailResponseDto> {
    const { email, verificationCode } = verifyEmailDto;
    const normalizedEmail = email.toLowerCase();
    const key = this.emailVerifyKey(normalizedEmail);

    const raw = await this.redis.get(key);
    const verification = raw ? safeJsonParse<EmailVerification>(raw) : null;

    if (!verification) {
      throw new BadRequestException('인증 코드를 먼저 요청해주세요.');
    }

    // 만료 시간 확인
    if (Date.now() > verification.expiresAt) {
      await this.redis.del(key);
      throw new BadRequestException(
        '인증 코드가 만료되었습니다. 새로운 코드를 요청해주세요.',
      );
    }

    // 시도 횟수 확인 (5회 제한)
    if (verification.attempts >= 5) {
      await this.redis.del(key);
      throw new BadRequestException(
        '인증 시도 횟수를 초과했습니다. 새로운 코드를 요청해주세요.',
      );
    }

    // 인증 코드 확인
    if (verification.code !== verificationCode) {
      // attempts 동시 업데이트를 위해 CAS(WATCH/MULTI)로 반영
      for (let i = 0; i < 3; i++) {
        await this.redis.watch(key);
        const curRaw = await this.redis.get(key);
        if (!curRaw) {
          await this.redis.unwatch();
          throw new BadRequestException('인증 코드를 먼저 요청해주세요.');
        }
        const cur = safeJsonParse<EmailVerification>(curRaw);
        if (!cur) {
          await this.redis.unwatch();
          throw new BadRequestException('인증 코드 데이터가 손상되었습니다.');
        }

        const ttl = await this.redis.ttl(key);
        if (ttl <= 0) {
          await this.redis.unwatch();
          throw new BadRequestException(
            '인증 코드가 만료되었습니다. 새로운 코드를 요청해주세요.',
          );
        }

        const next: EmailVerification = {
          ...cur,
          attempts: (cur.attempts ?? 0) + 1,
        };

        const tx = this.redis.multi();
        tx.setex(key, ttl, JSON.stringify(next));
        const execResult = await tx.exec();
        if (execResult) {
          await this.redis.unwatch();
          throw new BadRequestException(
            `인증 코드가 일치하지 않습니다. (${next.attempts}/5)`,
          );
        }
        // 경쟁 상태: 재시도
      }

      // CAS 재시도 실패 시 보수적으로 실패 처리
      throw new BadRequestException(
        '인증 코드 확인 중 충돌이 발생했습니다. 잠시 후 다시 시도해주세요.',
      );
    }

    // 인증 성공 - 저장된 정보 삭제
    await this.redis.del(key);

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
          const existingProvider = (() => {
            const raw = (existingEmailUser.socialName || '').toLowerCase();
            if (raw.includes('kakao')) return 'kakao';
            if (raw.includes('naver')) return 'naver';
            if (raw.includes('google')) return 'google';
            if (!raw || raw === 'socialuser') return 'local';
            return 'unknown';
          })();
          throw new ConflictException({
            statusCode: 409,
            code: 'EMAIL_CONFLICT',
            existingProvider,
            message: `이미 사용 중인 이메일입니다. (기존 계정: ${existingEmailUser.socialName || '일반 회원'})`,
          });
        }
      }

      // 3. 회원가입 처리 (소셜 로그인은 패스워드 저장 안함)
      const normalizedBirthYear = this.normalizeBirthYear(birthyear);
      const normalizedGender = this.normalizeGender(gender);

      // email이 없으면 기본값 제공 (소셜 로그인에서 email이 없을 수 있음)
      const userEmail = normalizedEmail ?? `naver_${socialUid}@social.local`;

      user = this.userRepository.create({
        socialName: 'Naver',
        socialUid,
        email: userEmail,
        name: nickname ?? 'Naver User',
        gender: normalizedGender,
        birthYear: normalizedBirthYear,
        passwordHash: null,
        // 선택 정보는 가능한 경우 null로 저장
        address: null, // 네이버에서 주소를 제공하지 않을 수 있음
      });

      console.log('Creating new user:', user);
      await this.userRepository.save(user);
      await this.ensureUserStatsExists(user.userId, 'naver');
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
    const nickname = kakaoAccount
      ? getString(kakaoAccount.nickname)
      : undefined;
    const gender = kakaoAccount ? getString(kakaoAccount.gender) : undefined;
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
          const existingProvider = (() => {
            const raw = (existingEmailUser.socialName || '').toLowerCase();
            if (raw.includes('kakao')) return 'kakao';
            if (raw.includes('naver')) return 'naver';
            if (raw.includes('google')) return 'google';
            if (!raw || raw === 'socialuser') return 'local';
            return 'unknown';
          })();
          throw new ConflictException({
            statusCode: 409,
            code: 'EMAIL_CONFLICT',
            existingProvider,
            message: `이미 사용 중인 이메일입니다. (기존 계정: ${existingEmailUser.socialName || '일반 회원'})`,
          });
        }
      }

      // 3. 회원가입 처리 (소셜 로그인은 패스워드 저장 안함)
      const normalizedBirthYear = this.normalizeBirthYear(birthyear);
      const normalizedGender = this.normalizeGender(gender);

      // email이 없으면 기본값 제공 (소셜 로그인에서 email이 없을 수 있음)
      const userEmail = normalizedEmail ?? `kakao_${socialUid}@social.local`;

      user = this.userRepository.create({
        socialName: 'Kakao',
        socialUid,
        email: userEmail,
        name: nickname ?? 'Kakao User',
        gender: normalizedGender,
        birthYear: normalizedBirthYear,
        passwordHash: null,
        // 선택 정보는 가능한 경우 null로 저장
        address: null,
      });

      console.log('Creating new user:', user);
      await this.userRepository.save(user);
      await this.ensureUserStatsExists(user.userId, 'kakao');
    } else {
      // 기존 유저는 유저가 직접 수정했을 수 있으므로 null인 경우에만 보강
      const normalizedBirthYear = this.normalizeBirthYear(birthyear);
      const normalizedGender = this.normalizeGender(gender);

      let shouldUpdate = false;
      const candidateNickname = nickname ?? null;
      if (
        candidateNickname &&
        (user.name == null ||
          user.name.trim().length === 0 ||
          user.name === 'Kakao User')
      ) {
        user.name = candidateNickname;
        shouldUpdate = true;
      }
      if (user.gender == null && normalizedGender != null) {
        user.gender = normalizedGender;
        shouldUpdate = true;
      }
      if (user.birthYear == null && normalizedBirthYear != null) {
        user.birthYear = normalizedBirthYear;
        shouldUpdate = true;
      }

      if (shouldUpdate) {
        await this.userRepository.save(user);
      }
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
    const gender = isRecord(googleProfile)
      ? getString(googleProfile.gender)
      : undefined;
    const birthYear = isRecord(googleProfile)
      ? getStringOrNumber(googleProfile.birthYear)
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
          const existingProvider = (() => {
            const raw = (existingEmailUser.socialName || '').toLowerCase();
            if (raw.includes('kakao')) return 'kakao';
            if (raw.includes('naver')) return 'naver';
            if (raw.includes('google')) return 'google';
            if (!raw || raw === 'socialuser') return 'local';
            return 'unknown';
          })();
          throw new ConflictException({
            statusCode: 409,
            code: 'EMAIL_CONFLICT',
            existingProvider,
            message: `이미 사용 중인 이메일입니다. (기존 계정: ${existingEmailUser.socialName || '일반 회원'})`,
          });
        }
      }

      // 3. 회원가입 처리 (소셜 로그인은 패스워드 저장 안함)
      const normalizedBirthYear = this.normalizeBirthYear(birthYear);
      const normalizedGender = this.normalizeGender(gender);

      // email이 없으면 기본값 제공 (소셜 로그인에서 email이 없을 수 있음)
      const userEmail = normalizedEmail ?? `google_${socialUid}@social.local`;

      // 이메일의 @ 앞부분을 닉네임으로 사용
      const nickname = normalizedEmail
        ? normalizedEmail.split('@')[0]
        : 'Google User';

      user = this.userRepository.create({
        socialName: 'Google',
        socialUid,
        email: userEmail,
        name: nickname,
        gender: normalizedGender,
        birthYear: normalizedBirthYear,
        passwordHash: null,
        // 선택 정보는 가능한 경우 null로 저장
        address: null,
      });

      console.log('Creating new user:', user);
      await this.userRepository.save(user);
      await this.ensureUserStatsExists(user.userId, 'google');
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

    // 소셜 로그인 사용자는 비밀번호 재설정 불가
    if (!user.passwordHash) {
      throw new BadRequestException({
        statusCode: 400,
        message: '소셜 로그인 계정은 비밀번호 재설정이 불가능합니다.',
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
  async getGooglePKCEAuthUrl(): Promise<{
    authUrl: string;
    codeVerifier: string;
    state: string;
  }> {
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

    // state와 codeVerifier 매핑 저장 (초기 상태, 10분)
    const stateKey = this.pkceStateKey(state);
    const verifierKey = this.pkceVerifierKey(pkce.codeVerifier);
    const initialPkceData: PkceStateData = {
      accessToken: '', // 콜백에서 채워질 예정
      user: null, // 콜백에서 채워질 예정
      codeVerifier: pkce.codeVerifier,
      expiresAt: Date.now() + PKCE_TTL_INITIAL_SECONDS * 1000,
      isComplete: false, // 초기 상태는 미완료
    };

    const tx = this.redis.multi();
    tx.setex(
      stateKey,
      PKCE_TTL_INITIAL_SECONDS,
      JSON.stringify(initialPkceData),
    );
    tx.setex(verifierKey, PKCE_TTL_INITIAL_SECONDS, state);
    await tx.exec();

    const baseUrl = 'https://accounts.google.com/o/oauth2/auth';
    const params = new URLSearchParams();
    params.append('client_id', clientId!);
    params.append('redirect_uri', redirectUri);
    params.append('response_type', 'code');
    // People API(성별/생일)는 선택 정보지만, scope가 없으면 아예 조회가 불가능함
    params.append(
      'scope',
      [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/user.gender.read',
        'https://www.googleapis.com/auth/user.birthday.read',
      ].join(' '),
    );
    // 기존 동의 범위 + 추가 scope(필요 시)까지 함께 처리
    params.append('include_granted_scopes', 'true');
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
  async getKakaoPKCEAuthUrl(): Promise<{
    authUrl: string;
    codeVerifier: string;
    state: string;
  }> {
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

    // state와 codeVerifier 매핑 저장 (초기 상태, 10분)
    const stateKey = this.pkceStateKey(state);
    const verifierKey = this.pkceVerifierKey(pkce.codeVerifier);
    const initialPkceData: PkceStateData = {
      accessToken: '', // 콜백에서 채워질 예정
      user: null, // 콜백에서 채워질 예정
      codeVerifier: pkce.codeVerifier,
      expiresAt: Date.now() + PKCE_TTL_INITIAL_SECONDS * 1000,
      isComplete: false, // 초기 상태는 미완료
    };

    const tx = this.redis.multi();
    tx.setex(
      stateKey,
      PKCE_TTL_INITIAL_SECONDS,
      JSON.stringify(initialPkceData),
    );
    tx.setex(verifierKey, PKCE_TTL_INITIAL_SECONDS, state);
    await tx.exec();

    const baseUrl = 'https://kauth.kakao.com/oauth/authorize';
    const params = new URLSearchParams();
    params.append('client_id', clientId!);
    params.append('redirect_uri', redirectUri);
    params.append('response_type', 'code');
    params.append(
      'scope',
      ['account_email', 'name', 'gender', 'birthyear'].join(' '),
    );
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
  async getNaverPKCEAuthUrl(): Promise<{
    authUrl: string;
    codeVerifier: string;
    state: string;
  }> {
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

    // state와 codeVerifier 매핑 저장 (초기 상태, 10분)
    const stateKey = this.pkceStateKey(state);
    const verifierKey = this.pkceVerifierKey(pkce.codeVerifier);
    const initialPkceData: PkceStateData = {
      accessToken: '', // 콜백에서 채워질 예정
      user: null, // 콜백에서 채워질 예정
      codeVerifier: pkce.codeVerifier,
      expiresAt: Date.now() + PKCE_TTL_INITIAL_SECONDS * 1000,
      isComplete: false, // 초기 상태는 미완료
    };

    const tx = this.redis.multi();
    tx.setex(
      stateKey,
      PKCE_TTL_INITIAL_SECONDS,
      JSON.stringify(initialPkceData),
    );
    tx.setex(verifierKey, PKCE_TTL_INITIAL_SECONDS, state);
    await tx.exec();

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
      const stateKey = this.pkceStateKey(state);
      const existingRaw = await this.redis.get(stateKey);
      const existingPkceData = existingRaw
        ? safeJsonParse<PkceStateData>(existingRaw)
        : null;
      if (!existingPkceData) {
        throw new UnauthorizedException({
          code: 'INVALID_STATE',
          message: 'Invalid state - no matching PKCE data found',
        });
      }
      if (Date.now() > existingPkceData.expiresAt) {
        await this.redis.del(stateKey);
        throw new UnauthorizedException({
          code: 'AUTH_TIMEOUT',
          message: 'PKCE state expired',
        });
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

      const userData = userResponse.data as unknown as Record<string, unknown>;
      // 3. 추가 정보 가져오기 (생일, 성별) - 선택 정보이므로 실패해도 진행
      let peopleData: Record<string, unknown> | null = null;
      try {
        const peopleResponse = await axios.get(
          'https://people.googleapis.com/v1/people/me?personFields=birthdays,genders',
          {
            headers: {
              Authorization: `Bearer ${access_token}`,
            },
          },
        );
        peopleData = peopleResponse.data as unknown as Record<string, unknown>;
      } catch {
        peopleData = null;
      }

      const id = getStringOrNumber(userData['id']);
      const name = getString(userData['name']);
      const email = getString(userData['email']);

      // genders?.[0]?.value
      const genders = (peopleData?.['genders'] ?? []) as Array<
        Record<string, unknown>
      >;
      const genderValue = Array.isArray(genders)
        ? getString(genders[0]?.value)
        : undefined;
      const gender =
        genderValue === 'male' ? 'M' : genderValue === 'female' ? 'F' : 'U';

      // birthdays?.[0]?.date { year, month, day }
      const birthdays = (peopleData?.['birthdays'] ?? []) as Array<
        Record<string, unknown>
      >;
      const firstBirthday = Array.isArray(birthdays) ? birthdays[0] : undefined;
      const dateObj = firstBirthday
        ? getNested(firstBirthday, 'date')
        : undefined;
      const year = dateObj ? dateObj['year'] : undefined;
      const birthYear =
        typeof year === 'number' ? String(year) : getStringOrNumber(year);

      const googleProfile = { id, name, email, gender, birthYear };

      // 4. 회원가입/로그인 처리
      const authResult = await this.handleGoogleLogin(googleProfile);

      // 5. 기존 state 데이터 업데이트 (codeVerifier 유지, 로그인 완료 표시)
      const verifierKey = this.pkceVerifierKey(existingPkceData.codeVerifier);
      const updatedPkceData: PkceStateData = {
        accessToken: authResult.accessToken,
        user: googleProfile,
        codeVerifier: existingPkceData.codeVerifier, // 기존 codeVerifier 유지
        expiresAt: Date.now() + PKCE_TTL_AFTER_CALLBACK_SECONDS * 1000, // 5분으로 갱신
        isComplete: true, // 로그인 완료
      };

      const tx = this.redis.multi();
      tx.setex(
        stateKey,
        PKCE_TTL_AFTER_CALLBACK_SECONDS,
        JSON.stringify(updatedPkceData),
      );
      tx.setex(verifierKey, PKCE_TTL_AFTER_CALLBACK_SECONDS, state);
      await tx.exec();

      // 7. state 반환 (딥링크에 사용)
      return state;
    } catch (error) {
      // 이미 분류된 HttpException은 그대로 올려서 컨트롤러가 errorCode를 알 수 있게 함
      if (error instanceof HttpException) {
        const resp = error.getResponse() as unknown;
        const code =
          typeof resp === 'object' && resp !== null && 'code' in resp
            ? String((resp as { code?: unknown }).code)
            : 'INTERNAL_ERROR';
        this.logPkceError({
          provider: 'google',
          stage: 'callback',
          errorCode: code as PkceErrorCode,
          state,
          code,
          error,
        });
        throw error;
      }

      const errorCode: PkceErrorCode = axios.isAxiosError(error)
        ? 'PKCE_VERIFY_FAIL'
        : 'INTERNAL_ERROR';
      this.logPkceError({
        provider: 'google',
        stage: 'callback',
        errorCode,
        state,
        code,
        error,
      });

      if (axios.isAxiosError(error)) {
        throw new BadRequestException({
          code: 'PKCE_VERIFY_FAIL',
          message: 'Google PKCE verification failed',
        });
      }
      throw new InternalServerErrorException({
        code: 'INTERNAL_ERROR',
        message: 'Google PKCE internal error',
      });
    }
  }
  /**
   * Kakao PKCE 콜백 처리 - 사용자 정보 저장하고 state 반환
   */
  async handleKakaoPKCECallback(code: string, state: string): Promise<string> {
    try {
      // 0. 기존 state 데이터에서 code_verifier 조회
      const stateKey = this.pkceStateKey(state);
      const existingRaw = await this.redis.get(stateKey);
      const existingPkceData = existingRaw
        ? safeJsonParse<PkceStateData>(existingRaw)
        : null;
      if (!existingPkceData) {
        throw new UnauthorizedException({
          code: 'INVALID_STATE',
          message: 'Invalid state - no matching PKCE data found',
        });
      }
      if (Date.now() > existingPkceData.expiresAt) {
        await this.redis.del(stateKey);
        throw new UnauthorizedException({
          code: 'AUTH_TIMEOUT',
          message: 'PKCE state expired',
        });
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
      const verifierKey = this.pkceVerifierKey(existingPkceData.codeVerifier);
      const updatedPkceData: PkceStateData = {
        accessToken: authResult.accessToken,
        user: kakaoProfile,
        codeVerifier: existingPkceData.codeVerifier, // 기존 codeVerifier 유지
        expiresAt: Date.now() + PKCE_TTL_AFTER_CALLBACK_SECONDS * 1000, // 5분으로 갱신
        isComplete: true, // 로그인 완료
      };

      const tx = this.redis.multi();
      tx.setex(
        stateKey,
        PKCE_TTL_AFTER_CALLBACK_SECONDS,
        JSON.stringify(updatedPkceData),
      );
      tx.setex(verifierKey, PKCE_TTL_AFTER_CALLBACK_SECONDS, state);
      await tx.exec();

      // 5. state 반환 (딥링크에 사용)
      return state;
    } catch (error) {
      if (error instanceof HttpException) {
        const resp = error.getResponse() as unknown;
        const code =
          typeof resp === 'object' && resp !== null && 'code' in resp
            ? String((resp as { code?: unknown }).code)
            : 'INTERNAL_ERROR';
        this.logPkceError({
          provider: 'kakao',
          stage: 'callback',
          errorCode: code as PkceErrorCode,
          state,
          code,
          error,
        });
        throw error;
      }

      const errorCode: PkceErrorCode = axios.isAxiosError(error)
        ? 'PKCE_VERIFY_FAIL'
        : 'INTERNAL_ERROR';
      this.logPkceError({
        provider: 'kakao',
        stage: 'callback',
        errorCode,
        state,
        code,
        error,
      });

      if (axios.isAxiosError(error)) {
        throw new BadRequestException({
          code: 'PKCE_VERIFY_FAIL',
          message: 'Kakao PKCE verification failed',
        });
      }
      throw new InternalServerErrorException({
        code: 'INTERNAL_ERROR',
        message: 'Kakao PKCE internal error',
      });
    }
  }

  /**
   * Naver PKCE 콜백 처리 - 사용자 정보 저장하고 state 반환
   */
  async handleNaverPKCECallback(code: string, state: string): Promise<string> {
    try {
      // 0. 기존 state 데이터에서 code_verifier 조회
      const stateKey = this.pkceStateKey(state);
      const existingRaw = await this.redis.get(stateKey);
      const existingPkceData = existingRaw
        ? safeJsonParse<PkceStateData>(existingRaw)
        : null;
      if (!existingPkceData) {
        throw new UnauthorizedException({
          code: 'INVALID_STATE',
          message: 'Invalid state - no matching PKCE data found',
        });
      }
      if (Date.now() > existingPkceData.expiresAt) {
        await this.redis.del(stateKey);
        throw new UnauthorizedException({
          code: 'AUTH_TIMEOUT',
          message: 'PKCE state expired',
        });
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
      const verifierKey = this.pkceVerifierKey(existingPkceData.codeVerifier);
      const updatedPkceData: PkceStateData = {
        accessToken: authResult.accessToken,
        user: naverProfile,
        codeVerifier: existingPkceData.codeVerifier, // 기존 codeVerifier 유지
        expiresAt: Date.now() + PKCE_TTL_AFTER_CALLBACK_SECONDS * 1000, // 5분으로 갱신
        isComplete: true, // 로그인 완료
      };

      const tx = this.redis.multi();
      tx.setex(
        stateKey,
        PKCE_TTL_AFTER_CALLBACK_SECONDS,
        JSON.stringify(updatedPkceData),
      );
      tx.setex(verifierKey, PKCE_TTL_AFTER_CALLBACK_SECONDS, state);
      await tx.exec();

      // 5. state 반환 (딥링크에 사용)
      return state;
    } catch (error) {
      if (error instanceof HttpException) {
        const resp = error.getResponse() as unknown;
        const code =
          typeof resp === 'object' && resp !== null && 'code' in resp
            ? String((resp as { code?: unknown }).code)
            : 'INTERNAL_ERROR';
        this.logPkceError({
          provider: 'naver',
          stage: 'callback',
          errorCode: code as PkceErrorCode,
          state,
          code,
          error,
        });
        throw error;
      }

      const errorCode: PkceErrorCode = axios.isAxiosError(error)
        ? 'PKCE_VERIFY_FAIL'
        : 'INTERNAL_ERROR';
      this.logPkceError({
        provider: 'naver',
        stage: 'callback',
        errorCode,
        state,
        code,
        error,
      });

      if (axios.isAxiosError(error)) {
        throw new BadRequestException({
          code: 'PKCE_VERIFY_FAIL',
          message: 'Naver PKCE verification failed',
        });
      }
      throw new InternalServerErrorException({
        code: 'INTERNAL_ERROR',
        message: 'Naver PKCE internal error',
      });
    }
  }

  // 🔐 codeVerifier 검증으로 토큰 반환
  async exchangeTokenWithCodeVerifier(
    codeVerifier: string,
  ): Promise<{ accessToken: string }> {
    try {
      const verifierKey = this.pkceVerifierKey(codeVerifier);
      const state = await this.redis.get(verifierKey);
      if (!state) {
        throw new UnauthorizedException('Invalid or expired code verifier');
      }

      const stateKey = this.pkceStateKey(state);
      const raw = await this.redis.get(stateKey);
      const pkceData = raw ? safeJsonParse<PkceStateData>(raw) : null;
      if (!pkceData || Date.now() > pkceData.expiresAt) {
        const txCleanup = this.redis.multi();
        txCleanup.del(stateKey);
        txCleanup.del(verifierKey);
        await txCleanup.exec();
        throw new UnauthorizedException('Invalid or expired code verifier');
      }

      // 로그인이 완료되지 않은 경우
      if (!pkceData.isComplete || !pkceData.accessToken) {
        throw new UnauthorizedException('Social login not completed yet');
      }

      // 토큰 반환 데이터 저장
      const result = {
        accessToken: pkceData.accessToken, // 우리 서비스 JWT 토큰
      };

      // 성공적으로 토큰을 교환했으므로 state 삭제
      const tx = this.redis.multi();
      tx.del(stateKey);
      tx.del(verifierKey);
      await tx.exec();

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
  async checkAuthStatus(clientState?: string): Promise<{
    state: string | null;
    isComplete: boolean;
    message: string;
  }> {
    const now = Date.now();

    // 특정 clientState가 제공된 경우 해당 state만 확인
    if (clientState) {
      const stateKey = this.pkceStateKey(clientState);
      const raw = await this.redis.get(stateKey);
      const pkceData = raw ? safeJsonParse<PkceStateData>(raw) : null;

      if (!pkceData) {
        return {
          state: null,
          isComplete: false,
          message: '해당 상태를 찾을 수 없거나 만료되었습니다.',
        };
      }

      if (now > pkceData.expiresAt) {
        await this.redis.del(stateKey);
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
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${PKCE_STATE_KEY_PREFIX}*`,
        'COUNT',
        '50',
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        const raws = await this.redis.mget(...keys);
        for (let i = 0; i < keys.length; i++) {
          const raw = raws[i];
          if (!raw) continue;
          const data = safeJsonParse<PkceStateData>(raw);
          if (!data) continue;
          if (now > data.expiresAt) {
            await this.redis.del(keys[i]);
            continue;
          }
          if (data.isComplete) {
            const state = keys[i].replace(PKCE_STATE_KEY_PREFIX, '');
            return {
              state,
              isComplete: true,
              message: '소셜 로그인이 완료되었습니다.',
            };
          }
        }
      }
    } while (cursor !== '0');

    return {
      state: null,
      isComplete: false,
      message: '진행 중인 소셜 로그인이 없거나 아직 완료되지 않았습니다.',
    };
  }

  // 만료된 인증 데이터 정리
  private cleanupExpiredAuthData(): void {
    // Redis TTL로 자동 만료되므로 별도 정리가 필요 없습니다.
  }

  // ==================== 디버깅용 메서드들 ====================

  /**
   * 저장된 PKCE 상태들을 조회 (디버깅용)
   */
  async getDebugStates(): Promise<{
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
  }> {
    const now = Date.now();

    const statesList: Array<{
      state: string;
      isComplete: boolean;
      expiresAt: Date;
      hasUser: boolean;
      hasAccessToken: boolean;
      userEmail?: string;
    }> = [];

    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${PKCE_STATE_KEY_PREFIX}*`,
        'COUNT',
        '100',
      );
      cursor = nextCursor;
      if (keys.length === 0) continue;

      const raws = await this.redis.mget(...keys);
      for (let i = 0; i < keys.length; i++) {
        const raw = raws[i];
        if (!raw) continue;
        const data = safeJsonParse<PkceStateData>(raw);
        if (!data) continue;
        if (now > data.expiresAt) continue;
        const state = keys[i].replace(PKCE_STATE_KEY_PREFIX, '');
        const userEmail = _getUserEmailFromPkceUser(data.user);
        statesList.push({
          state,
          isComplete: data.isComplete,
          expiresAt: new Date(data.expiresAt),
          hasUser: !!data.user,
          hasAccessToken: !!data.accessToken,
          userEmail: userEmail ?? undefined,
        });
      }
    } while (cursor !== '0');

    const verificationsList: Array<{
      email: string;
      expiresAt: Date;
      attempts: number;
    }> = [];

    cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${EMAIL_VERIFY_KEY_PREFIX}*`,
        'COUNT',
        '100',
      );
      cursor = nextCursor;
      if (keys.length === 0) continue;

      const raws = await this.redis.mget(...keys);
      for (let i = 0; i < keys.length; i++) {
        const raw = raws[i];
        if (!raw) continue;
        const v = safeJsonParse<EmailVerification>(raw);
        if (!v) continue;
        if (now > v.expiresAt) continue;
        verificationsList.push({
          email: v.email,
          expiresAt: new Date(v.expiresAt),
          attempts: v.attempts,
        });
      }
    } while (cursor !== '0');

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
  async getDebugStateDetail(state: string): Promise<{
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
  }> {
    const stateKey = this.pkceStateKey(state);
    const raw = await this.redis.get(stateKey);
    const pkceData = raw ? safeJsonParse<PkceStateData>(raw) : null;

    if (!pkceData) {
      return {
        message: '해당 state를 찾을 수 없습니다.',
        exists: false,
      };
    }

    // 만료 확인
    if (Date.now() > pkceData.expiresAt) {
      await this.redis.del(stateKey);
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
        expiresAt: new Date(pkceData.expiresAt),
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
