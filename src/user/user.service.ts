import { HttpException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
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

    return { accessToken };
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
}
