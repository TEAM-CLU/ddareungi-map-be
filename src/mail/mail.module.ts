import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

@Module({
  providers: [MailService],
  exports: [MailService], // 다른 모듈에서 사용할 수 있도록 export
})
export class MailModule {}
