import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule], // MailService를 사용하기 위해 import
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService], // 다른 모듈에서 사용할 수 있도록 export
})
export class AuthModule {}
