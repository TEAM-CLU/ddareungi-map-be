import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User } from './entities/user.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]), // User 엔터티 등록
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'), // 환경 변수에서 JWT 비밀 키 가져오기
        signOptions: { expiresIn: configService.get<string>('JWT_EXPIRATION_TIME') }, // 환경 변수에서 만료 시간 가져오기
      }),
    }),
  ],
  providers: [UserService],
  controllers: [UserController],
  exports: [UserService], // 필요 시 다른 모듈에서 사용 가능하도록 export
})
export class UserModule {}
