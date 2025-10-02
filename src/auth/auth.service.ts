import { Injectable, BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { SendVerificationEmailDto, VerifyEmailDto} from './dto/email-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { User } from '../user/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
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


@Injectable()
export class AuthService {
  // 실제 프로덕션에서는 Redis나 데이터베이스를 사용해야 합니다
  private verificationCodes = new Map<string, EmailVerification>();
  // PKCE state별 사용자 정보 및 토큰 저장소 (codeVerifier 포함)
  private pkceStates = new Map<string, { accessToken: string; user: any; codeVerifier: string; expiresAt: Date }>();

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
    const { response: { id: socialUid, email, nickname, gender, birthday, birthyear} } = naverProfile;

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

      user = this.userRepository.create({
        socialName: 'Naver',
        socialUid,
        email,
        name: nickname ? nickname : 'Naver User',
        gender,
        birthDate: formattedBirthDate ? new Date(formattedBirthDate) : new Date('1970-01-01'),
        passwordHash,
        address: "Unknown", // 네이버에서 주소를 제공하지 않을 수 있음
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
    return { accessToken };
  }

  async handleKakaoLogin(kakaoProfile: any) {
    const { id: socialUid, kakao_account: { email, nickname, gender, birthday, birthyear } } = kakaoProfile;

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

      user = this.userRepository.create({
        socialName: 'Kakao',
        socialUid,
        email,
        name: nickname ? nickname : 'Kakao User',
        gender: gender === 'male' ? 'M' : (gender === 'female' ? 'F' : 'U'),
        birthDate: formattedBirthDate ? new Date(formattedBirthDate) : new Date('1970-01-01'),
        passwordHash,
        address: "Unknown",
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
    return { accessToken };
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

      // 생년월일 처리 개선
      let parsedBirthDate: Date;
      if (birthday && birthday !== 'unknown') {
        try {
          parsedBirthDate = new Date(birthday);
          // 유효하지 않은 날짜인 경우 기본값 사용
          if (isNaN(parsedBirthDate.getTime())) {
            parsedBirthDate = new Date('1970-01-01');
          }
        } catch (error) {
          parsedBirthDate = new Date('1970-01-01');
        }
      } else {
        parsedBirthDate = new Date('1970-01-01');
      }

      user = this.userRepository.create({
        socialName: 'Google',
        socialUid,
        email,
        name: name ? name : 'Google User',
        gender: gender || 'U', // Unknown으로 기본값 설정
        birthDate: parsedBirthDate,
        passwordHash,
        address: "Unknown",
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
    return { accessToken };
  }

  /**
   * 비밀번호 재설정 (이메일 인증 완료 후 호출)
   */
  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    const { email, newPassword } = resetPasswordDto;
    const normalizedEmail = email.toLowerCase();

    // 1. 사용자 존재 여부 확인
    const user = await this.userRepository.findOne({ 
      where: { email: normalizedEmail },
      select: ['userId', 'email', 'passwordHash']
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
        message: '현재 사용 중인 비밀번호와 동일합니다. 다른 비밀번호를 입력해주세요.',
      });
    }

    // 3. 새로운 비밀번호 해싱
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // 4. 비밀번호 업데이트 (updatedAt은 @UpdateDateColumn으로 자동 업데이트됨)
    await this.userRepository.update(user.userId, {
      passwordHash: hashedNewPassword,
    });

    return {
      message: '비밀번호가 성공적으로 재설정되었습니다.',
    };
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
      codeChallengeMethod: 'S256'
    };
  }

  /**
   * Google PKCE 로그인 URL 생성
   */
  getGooglePKCEAuthUrl() {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const redirectUri = this.configService.get<string>('GOOGLE_PKCE_CALLBACK_URL');
    if (!redirectUri) {
      throw new BadRequestException('GOOGLE_PKCE_CALLBACK_URL 환경변수가 설정되지 않았습니다.');
    }
    
    const pkce = this.generatePKCE();
    const state = crypto.randomBytes(16).toString('base64url');
    
    // state와 codeVerifier 매핑 저장 (초기 상태)
    this.pkceStates.set(state, {
      accessToken: '', // 콜백에서 채워질 예정
      user: null,      // 콜백에서 채워질 예정
      codeVerifier: pkce.codeVerifier,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10분
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
      state: state
    };
  }

  /**
   * Kakao PKCE 로그인 URL 생성
   */
  getKakaoPKCEAuthUrl() {
    const clientId = this.configService.get<string>('KAKAO_CLIENT_ID');
    const redirectUri = this.configService.get<string>('KAKAO_PKCE_CALLBACK_URL');
    if (!redirectUri) {
      throw new BadRequestException('KAKAO_PKCE_CALLBACK_URL 환경변수가 설정되지 않았습니다.');
    }
    
    const pkce = this.generatePKCE();
    const state = crypto.randomBytes(16).toString('base64url');
    
    // state와 codeVerifier 매핑 저장 (초기 상태)
    this.pkceStates.set(state, {
      accessToken: '', // 콜백에서 채워질 예정
      user: null,      // 콜백에서 채워질 예정
      codeVerifier: pkce.codeVerifier,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10분
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
      state: state
    };
  }

  /**
   * Naver PKCE 로그인 URL 생성
   */
  getNaverPKCEAuthUrl() {
    const clientId = this.configService.get<string>('NAVER_CLIENT_ID');
    const redirectUri = this.configService.get<string>('NAVER_PKCE_CALLBACK_URL');
    if (!redirectUri) {
      throw new BadRequestException('NAVER_PKCE_CALLBACK_URL 환경변수가 설정되지 않았습니다.');
    }
    
    const pkce = this.generatePKCE();
    const state = crypto.randomBytes(16).toString('base64url');
    
    // state와 codeVerifier 매핑 저장 (초기 상태)
    this.pkceStates.set(state, {
      accessToken: '', // 콜백에서 채워질 예정
      user: null,      // 콜백에서 채워질 예정
      codeVerifier: pkce.codeVerifier,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10분
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
      state: state
    };
  }

  /**
   * Google PKCE 콜백 처리 - 사용자 정보 저장하고 state 반환
   */
  async handleGooglePKCECallback(code: string, state: string): Promise<string> {
    try {
      // 1. Access Token 요청 (code_verifier는 프론트에서 관리)
      const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: this.configService.get<string>('GOOGLE_CLIENT_ID'),
        client_secret: this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: this.configService.get<string>('GOOGLE_PKCE_CALLBACK_URL') || 'http://localhost:3000/auth/google/pkce/callback'
      });

      const { access_token } = tokenResponse.data;

      // 2. 사용자 정보 가져오기
      const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      });

      // 3. 추가 정보 가져오기 (생일, 성별)
      const peopleResponse = await axios.get('https://people.googleapis.com/v1/people/me?personFields=birthdays,genders', {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      });

      const googleProfile = {
        id: userResponse.data.id,
        name: userResponse.data.name,
        email: userResponse.data.email,
        gender: peopleResponse.data.genders?.[0]?.value === 'male' ? 'M' : (peopleResponse.data.genders?.[0]?.value === 'female' ? 'F' : 'U'),
        birthday: peopleResponse.data.birthdays?.[0]?.date
          ? `${peopleResponse.data.birthdays[0].date.year}-${peopleResponse.data.birthdays[0].date.month.toString().padStart(2, '0')}-${peopleResponse.data.birthdays[0].date.day.toString().padStart(2, '0')}`
          : null,
      };

      // 4. 기존 state 데이터 확인
      const existingPkceData = this.pkceStates.get(state);
      if (!existingPkceData) {
        throw new UnauthorizedException('Invalid state - no matching PKCE data found');
      }
      
      // 5. 회원가입/로그인 처리
      const authResult = await this.handleGoogleLogin(googleProfile);
      
      // 6. 기존 state 데이터 업데이트 (codeVerifier 유지)
      this.pkceStates.set(state, {
        accessToken: authResult.accessToken,
        user: googleProfile,
        codeVerifier: existingPkceData.codeVerifier, // 기존 codeVerifier 유지
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5분으로 갱신
      });

      // 7. state 반환 (딥링크에 사용)
      return state;
    } catch (error) {
      console.error('Google PKCE callback error:', error);
      throw new BadRequestException('Google 로그인 처리 중 오류가 발생했습니다.');
    }
  }

  /**
   * Kakao PKCE 콜백 처리 - 사용자 정보 저장하고 state 반환
   */
  async handleKakaoPKCECallback(code: string, state: string): Promise<string> {
    try {
      // 1. Access Token 요청 (code_verifier는 프론트에서 관리)
      const tokenResponse = await axios.post('https://kauth.kakao.com/oauth/token', {
        grant_type: 'authorization_code',
        client_id: this.configService.get<string>('KAKAO_CLIENT_ID'),
        client_secret: this.configService.get<string>('KAKAO_CLIENT_SECRET'),
        code: code,
        redirect_uri: this.configService.get<string>('KAKAO_PKCE_CALLBACK_URL') || 'http://localhost:3000/auth/kakao/pkce/callback'
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token } = tokenResponse.data;

      // 2. 사용자 정보 가져오기
      const userResponse = await axios.get('https://kapi.kakao.com/v2/user/me', {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      });

      const kakaoProfile = userResponse.data;
      
      // 3. 기존 state 데이터 확인
      const existingPkceData = this.pkceStates.get(state);
      if (!existingPkceData) {
        throw new UnauthorizedException('Invalid state - no matching PKCE data found');
      }
      
      // 4. 회원가입/로그인 처리
      const authResult = await this.handleKakaoLogin(kakaoProfile);
      
      // 5. 기존 state 데이터 업데이트 (codeVerifier 유지)
      this.pkceStates.set(state, {
        accessToken: authResult.accessToken,
        user: kakaoProfile,
        codeVerifier: existingPkceData.codeVerifier, // 기존 codeVerifier 유지
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5분으로 갱신
      });

      // 6. state 반환 (딥링크에 사용)
      return state;
    } catch (error) {
      console.error('Kakao PKCE callback error:', error);
      throw new BadRequestException('카카오 로그인 처리 중 오류가 발생했습니다.');
    }
  }

  /**
   * Naver PKCE 콜백 처리 - 사용자 정보 저장하고 state 반환
   */
  async handleNaverPKCECallback(code: string, state: string): Promise<string> {
    try {
      // 1. Access Token 요청 (code_verifier는 프론트에서 관리)
      const tokenResponse = await axios.post('https://nid.naver.com/oauth2.0/token', {
        grant_type: 'authorization_code',
        client_id: this.configService.get<string>('NAVER_CLIENT_ID'),
        client_secret: this.configService.get<string>('NAVER_CLIENT_SECRET'),
        code: code,
        redirect_uri: this.configService.get<string>('NAVER_PKCE_CALLBACK_URL') || 'http://localhost:3000/auth/naver/pkce/callback',
        state: state
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token } = tokenResponse.data;

      // 2. 사용자 정보 가져오기
      const userResponse = await axios.get('https://openapi.naver.com/v1/nid/me', {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      });

      const naverProfile = userResponse.data;
      
      // 3. 기존 state 데이터 확인
      const existingPkceData = this.pkceStates.get(state);
      if (!existingPkceData) {
        throw new UnauthorizedException('Invalid state - no matching PKCE data found');
      }
      
      // 4. 회원가입/로그인 처리
      const authResult = await this.handleNaverLogin(naverProfile);
      
      // 5. 기존 state 데이터 업데이트 (codeVerifier 유지)
      this.pkceStates.set(state, {
        accessToken: authResult.accessToken,
        user: naverProfile,
        codeVerifier: existingPkceData.codeVerifier, // 기존 codeVerifier 유지
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5분으로 갱신
      });

      // 6. state 반환 (딥링크에 사용)
      return state;
    } catch (error) {
      console.error('Naver PKCE callback error:', error);
      throw new BadRequestException('네이버 로그인 처리 중 오류가 발생했습니다.');
    }
  }

  // 🔐 codeVerifier 검증으로 토큰 반환
  async exchangeTokenWithCodeVerifier(codeVerifier: string, state: string): Promise<{ accessToken: string; user: any }> {
    try {
      // state로 저장된 사용자 정보 조회
      const pkceData = this.pkceStates.get(state);
      
      if (!pkceData) {
        throw new UnauthorizedException('Invalid or expired state');
      }
      
      if (pkceData.expiresAt < new Date()) {
        this.pkceStates.delete(state);
        throw new UnauthorizedException('State has expired');
      }
      
      // codeVerifier 일치 확인
      if (pkceData.codeVerifier !== codeVerifier) {
        throw new UnauthorizedException('Invalid code verifier');
      }
      
      // 사용된 state 삭제
      this.pkceStates.delete(state);
      
      return {
        accessToken: pkceData.accessToken, // 우리 서비스 JWT 토큰
        user: pkceData.user
      };
      
    } catch (error) {
      console.error('Token exchange error:', error);
      throw new UnauthorizedException('토큰 교환에 실패했습니다.');
    }
  }

  // 🔐 쿠키 기반 토큰 검증 및 사용자 정보 조회
  async verifyTokenFromCookie(token: string): Promise<{ userId: number; email: string; name: string }> {
    try {
      // JWT 토큰 검증
      const payload = this.jwtService.verify(token);
      
      // 사용자 정보 조회
      const user = await this.userRepository.findOne({
        where: { userId: payload.userId }
      });
      
      if (!user) {
        throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
      }
      
      return {
        userId: user.userId,
        email: user.email,
        name: user.name
      };
      
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new UnauthorizedException('토큰이 만료되었습니다.');
      } else if (error.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('유효하지 않은 토큰입니다.');
      }
      throw new UnauthorizedException('토큰 검증에 실패했습니다.');
    }
  }

}
