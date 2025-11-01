import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MailModule } from '../mail/mail.module';
import { User } from '../user/entities/user.entity';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtNaverStrategy } from './strategies/naver.strategy';
import { JwtKakaoStrategy } from './strategies/kakao.strategy';
import { JwtGoogleStrategy } from './strategies/google.strategy';
import { CryptoService } from '../common/crypto.service';

@Module({
  imports: [
    MailModule,
    TypeOrmModule.forFeature([User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'), // 환경 변수에서 JWT 비밀 키 가져오기
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRATION_TIME'),
        }, // 환경 변수에서 만료 시간 가져오기
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    CryptoService,
    JwtNaverStrategy,
    JwtKakaoStrategy,
    JwtGoogleStrategy,
  ],
  exports: [AuthService],
})
export class AuthModule {}
