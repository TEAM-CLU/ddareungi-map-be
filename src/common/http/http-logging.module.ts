import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HttpClientLoggingService } from './http-logging.service';

@Global()
@Module({
  imports: [HttpModule],
  providers: [HttpClientLoggingService],
  exports: [HttpModule],
})
export class HttpLoggingModule {}
