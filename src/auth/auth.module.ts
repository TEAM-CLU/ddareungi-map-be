import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [UsersService],
  controllers: [AuthController],
  providers: [AuthService, JwtService],
})
export class AuthModule {}
