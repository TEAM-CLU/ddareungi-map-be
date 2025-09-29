import { HttpException, Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { UserInfoResponseDto } from './dto/user-info-response.dto';
import { UpdateUserInfoDto } from './dto/update-user-info.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';


@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService, // JwtService 주입
  ) {}

  async register(createUserDto: CreateUserDto): Promise<User> {
    const { email, password, socialUid } = createUserDto;

    // 이메일 유효성 검사
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new HttpException({
        statusCode: 400,
        message: '올바르지 않은 이메일 구조입니다. 다시 확인해주세요.',
      }, 400);
    }

    // 비밀번호 길이 검사
    if (password.length < 8 || password.length > 255) {
      throw new HttpException({
        statusCode: 400,
        message: '비밀번호는 최소 8글자 이상, 최대 255글자 이하여야 합니다.',
      }, 400);
    }

    // 중복 이메일 검사
    const existingUser = await this.userRepository.findOne({ where: { email } });
    if (existingUser) {
      throw new HttpException({
        statusCode: 409,
        message: '이미 사용 중인 이메일입니다.',
      }, 409);
    }

    // 중복 socialUid 검사
    if (socialUid) {
      const existingSocialUser = await this.userRepository.findOne({ where: { socialUid } });
      if (existingSocialUser) {
        throw new HttpException({
          statusCode: 409,
          message: '이미 사용 중인 소셜 UID입니다.',
        }, 409);
      }
    }

    // 비밀번호 해싱
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = this.userRepository.create({ ...createUserDto, passwordHash: hashedPassword });

    try {
      return await this.userRepository.save(user);
    } catch (error) {
      throw new HttpException({
        statusCode: 400,
        message: '사용자 등록 중 문제가 발생했습니다. 다시 시도해주세요.',
      }, 400);
    }
  }

  async login(loginUserDto: LoginUserDto): Promise<{ accessToken: string }> {
    const { email, password } = loginUserDto;

    // 이메일로 사용자 찾기
    const user = await this.userRepository.findOne({ where: { email } });
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
      select: ['name', 'birthDate', 'gender', 'address']
    });

    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
      });
    }

    // 디버깅: birthDate의 타입과 값 확인
    console.log('birthDate value:', user.birthDate);
    console.log('birthDate type:', typeof user.birthDate);
    console.log('birthDate instanceof Date:', user.birthDate instanceof Date);

    // birthDate를 안전하게 문자열로 변환
    let formattedBirthDate: string;
    
    if (!user.birthDate) {
      formattedBirthDate = '1970-01-01';
    } else if (user.birthDate instanceof Date) {
      formattedBirthDate = user.birthDate.toISOString().split('T')[0];
    } else if (typeof user.birthDate === 'string') {
      // PostgreSQL date 타입은 문자열로 반환될 수 있음 (예: '1990-01-01')
      const birthDateStr = user.birthDate as string;
      if (birthDateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // 이미 YYYY-MM-DD 형식인 경우
        formattedBirthDate = birthDateStr;
      } else {
        // 다른 형식인 경우 Date로 변환 후 포맷팅
        const date = new Date(birthDateStr);
        if (isNaN(date.getTime())) {
          formattedBirthDate = '1970-01-01';
        } else {
          formattedBirthDate = date.toISOString().split('T')[0];
        }
      }
    } else {
      formattedBirthDate = '1970-01-01'; // 기본값
    }

    return {
      name: user.name,
      birthDate: formattedBirthDate,
      gender: user.gender,
      address: user.address,
    };
  }

  /**
   * 사용자 정보 업데이트
   */
  async updateUserInfo(userId: number, updateUserInfoDto: UpdateUserInfoDto): Promise<UserInfoResponseDto> {
    // 사용자 존재 여부 확인
    const user = await this.userRepository.findOne({
      where: { userId }
    });

    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
      });
    }

    // 생년월일 문자열을 Date 객체로 변환
    const birthDate = new Date(updateUserInfoDto.birthDate);
    if (isNaN(birthDate.getTime())) {
      throw new HttpException({
        statusCode: 400,
        message: '올바르지 않은 생년월일 형식입니다.',
      }, 400);
    }

    // 사용자 정보 업데이트 (updatedAt은 @UpdateDateColumn으로 자동 업데이트됨)
    const updateData: Partial<User> = {
      name: updateUserInfoDto.name,
      birthDate: birthDate,
      gender: updateUserInfoDto.gender,
    };

    // address가 제공된 경우에만 업데이트
    if (updateUserInfoDto.address !== undefined) {
      updateData.address = updateUserInfoDto.address;
    }

    await this.userRepository.update(userId, updateData);

    // 업데이트된 사용자 정보 반환
    return this.getUserInfo(userId);
  }

  /**
   * 비밀번호 변경
   */
  async changePassword(userId: number, changePasswordDto: ChangePasswordDto): Promise<{ message: string }> {
    const { currentPassword, newPassword } = changePasswordDto;

    // 사용자 존재 여부 확인
    const user = await this.userRepository.findOne({
      where: { userId },
      select: ['userId', 'passwordHash']
    });

    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        message: '사용자를 찾을 수 없습니다.',
      });
    }

    // 현재 비밀번호 확인
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: '현재 비밀번호가 올바르지 않습니다.',
      });
    }

    // 새로운 비밀번호가 현재 비밀번호와 같은지 확인
    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      throw new HttpException({
        statusCode: 400,
        message: '같은 비밀번호입니다. 다른 비밀번호를 입력해주세요.',
      }, 400);
    }

    // 새로운 비밀번호 해싱
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // 비밀번호 업데이트 (updatedAt은 @UpdateDateColumn으로 자동 업데이트됨)
    await this.userRepository.update(userId, {
      passwordHash: hashedNewPassword,
    });

    return {
      message: '비밀번호가 성공적으로 변경되었습니다.',
    };
  }

}
