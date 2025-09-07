import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SignUpDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { User } from 'src/users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async signUp(signUpDto: SignUpDto): Promise<Omit<User, 'passwordHash'>> {
    const existingUser = await this.usersService.findByEmail(signUpDto.email);
    if (existingUser) {
      throw new ConflictException('이미 가입된 이메일입니다.');
    }

    const { password, ...userData } = signUpDto;
    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await this.usersService.create(userData, passwordHash);

    const { passwordHash: _, ...result } = newUser;
    return result;
  }

  async login(
    loginDto: LoginDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const { email, password } = loginDto;

    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('이메일 또는 비밀번호를 확인해주세요.');
    }

    const isPasswordMatching = await bcrypt.compare(
      password,
      user.passwordHash,
    );
    if (!isPasswordMatching) {
      throw new UnauthorizedException('이메일 또는 비밀번호를 확인해주세요.');
    }

    await this.usersService.updateLastLogin(user.userId);

    const payload = { sub: user.userId, email: user.email };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '30m' });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

    return { accessToken, refreshToken };
  }
}
