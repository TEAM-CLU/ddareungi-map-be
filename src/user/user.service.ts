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

  private parseBirthDate(birthDate: string): {
    birthYear: string;
    birthDay: string;
  } {
    const raw = birthDate.trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      throw new HttpException(
        {
          statusCode: 400,
          message: '올바르지 않은 생년월일 형식입니다. (YYYY-MM-DD)',
        },
        400,
      );
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      throw new HttpException(
        {
          statusCode: 400,
          message: '올바르지 않은 생년월일 값입니다. (YYYY-MM-DD)',
        },
        400,
      );
    }

    const isLeapYear = (y: number) =>
      (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const daysInMonth = (y: number, m: number) => {
      const base = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
      return m === 2 && isLeapYear(y) ? 29 : base;
    };
    if (day > daysInMonth(year, month)) {
      throw new HttpException(
        {
          statusCode: 400,
          message: '올바르지 않은 생년월일 값입니다. (YYYY-MM-DD)',
        },
        400,
      );
    }

    return {
      birthYear: match[1],
      birthDay: `${match[2]}-${match[3]}`,
    };
  }

  private formatBirthDate(
    birthYear: string | null | undefined,
    birthDay: string | null | undefined,
  ): string | null {
    const yearValid =
      typeof birthYear === 'string' && /^\d{4}$/.test(birthYear);
    const dayValid =
      typeof birthDay === 'string' && /^\d{2}-\d{2}$/.test(birthDay);

    // 둘 다 없으면 정보 없음
    if (!yearValid && !dayValid) {
      return null;
    }

    // 둘 다 유효하면 YYYY-MM-DD 형식으로 반환
    if (yearValid && dayValid) {
      return `${birthYear}-${birthDay}`;
    }

    // 연도만 있는 경우: 연도만이라도 반환
    if (yearValid && !dayValid) {
      return birthYear;
    }

    // 월-일만 있는 경우: MM-DD만이라도 반환
    if (!yearValid && dayValid) {
      return birthDay;
    }

    return null;
  }

  private extractBirthYear(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    return /^\d{4}$/.test(value) ? value : null;
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
    const birthDate = createUserDto.birthDate;
    if (typeof birthDate === 'string') {
      const { birthYear, birthDay } = this.parseBirthDate(birthDate);
      newUser.birthYear = birthYear;
      newUser.birthDay = birthDay;
    } else {
      newUser.birthYear = null;
      newUser.birthDay = null;
    }
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
        'birthDay',
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
    const birthYear: string | null = user.birthYear ?? null;
    const birthDay: string | null = user.birthDay ?? null;
    const birthDate = this.formatBirthDate(birthYear, birthDay);

    return {
      name: user.name,
      gender,
      birthDate,
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

    if (updateUserInfoDto.birthDate !== undefined) {
      const birthDate = updateUserInfoDto.birthDate;
      if (birthDate === null) {
        updateData.birthYear = null;
        updateData.birthDay = null;
      } else if (typeof birthDate === 'string') {
        const { birthYear, birthDay } = this.parseBirthDate(birthDate);
        updateData.birthYear = birthYear;
        updateData.birthDay = birthDay;
      } else {
        updateData.birthYear = null;
        updateData.birthDay = null;
      }
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
        'birthDay',
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

    const birthYear: string | null = user.birthYear ?? null;
    const birthDay: string | null = user.birthDay ?? null;
    const birthDate = this.formatBirthDate(birthYear, birthDay);

    return {
      name: user.name,
      email: user.email,
      birthDate,
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
