import {
  HttpException,
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserStats } from './entities/user-stats.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { UserInfoResponseDto } from './dto/user-info-response.dto';
import { UpdateUserInfoDto } from './dto/update-user-info.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MyPageInfoResponseDto } from './dto/mypage-info-response.dto';
import { CheckEmailDto } from './dto/check-email.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserStats)
    private readonly userStatsRepository: Repository<UserStats>,
    private readonly jwtService: JwtService, // JwtService 주입
  ) {}

  private async ensureUserStatsExists(
    userId: number,
    flow: 'register',
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

  private normalizeGender(value: string | null | undefined): string | null {
    if (!value) return null;
    const v = value.toLowerCase();
    if (v === 'm' || v === 'male') return 'M';
    if (v === 'f' || v === 'female') return 'F';
    if (v === 'u' || v === 'unknown') return null;
    return null;
  }

  private parseBirthYear(birthYear: string | null | undefined): string | null {
    if (!birthYear) return null;
    if (!/^\d{4}$/.test(birthYear)) {
      throw new HttpException(
        {
          statusCode: 400,
          message: '올바르지 않은 출생연도 형식입니다.',
        },
        400,
      );
    }

    return birthYear;
  }

  /**
   * 회원 탈퇴 (자기 자신)
   */
  async withdraw(userId: number): Promise<void> {
    const user = await this.userRepository.findOne({ where: { userId } });
    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
      });
    }
    await this.userRepository.remove(user); // onDelete: 'CASCADE'로 연관 데이터도 삭제
  }

  /**
   * 이메일 기반 회원 탈퇴 (관리자/운영 도구용)
   */
  async withdrawByEmail(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase();
    const user = await this.userRepository.findOne({
      where: { email: normalizedEmail },
      select: ['userId'],
    });
    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
      });
    }
    await this.withdraw(user.userId);
  }

  async register(createUserDto: CreateUserDto): Promise<void> {
    const { email, password } = createUserDto;
    const normalizedEmail = email.toLowerCase(); // 이메일 정규화

    // 이메일 유효성 검사
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new HttpException(
        {
          statusCode: 400,
          message: '올바르지 않은 이메일 구조입니다. 다시 확인해주세요.',
        },
        400,
      );
    }

    // 비밀번호 길이 검사
    if (password.length < 8 || password.length > 255) {
      throw new HttpException(
        {
          statusCode: 400,
          message: '비밀번호는 최소 8글자 이상, 최대 255글자 이하여야 합니다.',
        },
        400,
      );
    }

    // 중복 이메일 검사 (정규화된 이메일 사용)
    const existingUser = await this.userRepository.findOne({
      where: { email: normalizedEmail },
      select: ['userId'],
    });
    if (existingUser) {
      throw new ConflictException({
        statusCode: 409,
        message: '이미 사용 중인 이메일입니다.',
      });
    }

    // 비밀번호 해싱
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User();
    newUser.socialUid = createUserDto.socialUid ?? null;
    newUser.email = normalizedEmail;
    newUser.passwordHash = hashedPassword;
    newUser.name = createUserDto.name;
    newUser.gender = this.normalizeGender(createUserDto.gender);
    newUser.birthYear = this.parseBirthYear(createUserDto.birthYear);
    newUser.address = createUserDto.address ?? null;
    newUser.consentedAt = createUserDto.consentedAt
      ? new Date(createUserDto.consentedAt)
      : null;
    newUser.requiredAgreed = createUserDto.requiredAgreed ?? false;
    newUser.optionalAgreed = createUserDto.optionalAgreed ?? false;
    newUser.socialName = 'SocialUser';

    try {
      await this.userRepository.save(newUser);
      await this.ensureUserStatsExists(newUser.userId, 'register');
    } catch {
      throw new HttpException(
        {
          statusCode: 400,
          message: '사용자 등록 중 문제가 발생했습니다. 다시 시도해주세요.',
        },
        400,
      );
    }
  }

  async login(loginUserDto: LoginUserDto): Promise<{ accessToken: string }> {
    const { email, password } = loginUserDto;
    const normalizedEmail = email.toLowerCase(); // 이메일 정규화

    // 이메일로 사용자 찾기 (정규화된 이메일 사용)
    const user = await this.userRepository.findOne({
      where: { email: normalizedEmail },
    });
    if (!user) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: '이메일 또는 비밀번호가 올바르지 않습니다.',
      });
    }

    // 비밀번호 확인
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: '이메일 또는 비밀번호가 올바르지 않습니다.',
      });
    }

    // JWT 토큰 생성
    const payload = { userId: user.userId, email: user.email };
    const accessToken = this.jwtService.sign(payload);
    user.lastLogin = new Date();
    await this.userRepository.save(user);

    return { accessToken };
  }

  /**
   * 토큰을 통해 사용자 정보 조회
   */
  async getUserInfo(userId: number): Promise<UserInfoResponseDto> {
    const user = await this.userRepository.findOne({
      where: { userId },
      select: [
        'name',
        'birthYear',
        'gender',
        'address',
        'consentedAt',
        'requiredAgreed',
        'optionalAgreed',
      ],
    });

    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
      });
    }

    const gender = user.gender ?? 'U';

    return {
      name: user.name,
      gender,
      birthYear: user.birthYear ?? null,
      address: user.address,
      consentedAt: user.consentedAt,
      requiredAgreed: user.requiredAgreed,
      optionalAgreed: user.optionalAgreed,
    };
  }

  /**
   * 사용자 정보 업데이트
   */
  async updateUserInfo(
    userId: number,
    updateUserInfoDto: UpdateUserInfoDto,
  ): Promise<UserInfoResponseDto> {
    // 사용자 존재 여부 확인
    const user = await this.userRepository.findOne({
      where: { userId },
    });

    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
      });
    }

    // 사용자 정보 업데이트 (updatedAt은 @UpdateDateColumn으로 자동 업데이트됨)
    const updateData: Partial<User> = {
      name: updateUserInfoDto.name,
    };

    if (updateUserInfoDto.birthYear !== undefined) {
      updateData.birthYear = this.parseBirthYear(
        updateUserInfoDto.birthYear as string | null | undefined,
      );
    }

    if (updateUserInfoDto.gender !== undefined) {
      updateData.gender = this.normalizeGender(updateUserInfoDto.gender);
    }

    // address가 제공된 경우에만 업데이트
    if (updateUserInfoDto.address !== undefined) {
      updateData.address = updateUserInfoDto.address;
    }

    // 동의 정보가 제공된 경우 업데이트
    if (updateUserInfoDto.consentedAt !== undefined) {
      updateData.consentedAt = new Date(updateUserInfoDto.consentedAt);
    }

    if (updateUserInfoDto.requiredAgreed !== undefined) {
      updateData.requiredAgreed = updateUserInfoDto.requiredAgreed;
    }

    if (updateUserInfoDto.optionalAgreed !== undefined) {
      updateData.optionalAgreed = updateUserInfoDto.optionalAgreed;
    }

    await this.userRepository.update(userId, updateData);

    // 업데이트된 사용자 정보 반환
    return this.getUserInfo(userId);
  }

  /**
   * 비밀번호 변경
   */
  async changePassword(
    userId: number,
    changePasswordDto: ChangePasswordDto,
  ): Promise<void> {
    const { currentPassword, newPassword } = changePasswordDto;

    // 사용자 존재 여부 확인
    const user = await this.userRepository.findOne({
      where: { userId },
      select: ['userId', 'passwordHash'],
    });

    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
      });
    }

    // 현재 비밀번호 확인
    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: '현재 비밀번호가 올바르지 않습니다.',
      });
    }

    // 새로운 비밀번호가 현재 비밀번호와 같은지 확인
    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      throw new HttpException(
        {
          statusCode: 400,
          message: '같은 비밀번호입니다. 다른 비밀번호를 입력해주세요.',
        },
        400,
      );
    }

    // 새로운 비밀번호 해싱
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // 비밀번호 업데이트 (updatedAt은 @UpdateDateColumn으로 자동 업데이트됨)
    await this.userRepository.update(userId, {
      passwordHash: hashedNewPassword,
    });
  }

  /**
   * 마이페이지 정보 조회
   */
  async getMyPageInfo(userId: number): Promise<MyPageInfoResponseDto> {
    const user = await this.userRepository.findOne({
      where: { userId },
      select: [
        'name',
        'email',
        'birthYear',
        'gender',
        'address',
        'consentedAt',
        'requiredAgreed',
        'optionalAgreed',
      ],
    });

    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
      });
    }

    // userStats 조회
    const userStats = await this.userStatsRepository.findOne({
      where: { userId },
    });

    return {
      name: user.name,
      email: user.email,
      birthYear: user.birthYear ?? null,
      gender: user.gender ?? null,
      address: user.address ?? null,
      totalDistance: userStats?.totalUsageDistance ?? null,
      totalTime: userStats?.totalUsageTime ?? null,
      calories: userStats?.totalCaloriesBurned ?? null,
      plantingTree: userStats?.totalTreesPlanted ?? null,
      carbonReduction: userStats?.totalCarbonFootprint ?? null,
      consentedAt: user.consentedAt ?? null,
      requiredAgreed: user.requiredAgreed,
      optionalAgreed: user.optionalAgreed,
    };
  }

  /**
   * 이메일 중복 확인
   */
  async checkEmailExists(checkEmailDto: CheckEmailDto): Promise<void> {
    const { email } = checkEmailDto;
    const normalizedEmail = email.toLowerCase();

    const existingUser = await this.userRepository.findOne({
      where: { email: normalizedEmail },
      select: ['userId'],
    });

    if (existingUser) {
      throw new ConflictException({
        statusCode: 409,
        message: '이메일이 중복되었습니다.',
      });
    }
  }
}
