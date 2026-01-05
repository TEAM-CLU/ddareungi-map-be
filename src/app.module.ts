import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { StationsModule } from './stations/stations.module';
import { RoutesModule } from './routes/routes.module';
import { NavigationModule } from './navigation/navigation.module';
import { TtsModule } from './tts/tts.module';
import { ClsModule } from 'nestjs-cls';
import { RedisModule } from '@liaoliaots/nestjs-redis';
import { HttpLoggingModule } from './common/http/http-logging.module';
import { TypeormWinstonLogger } from './common/logger/typeorm-logger';
import type { Request } from 'express';

type ClsLike = {
  set(key: string, value: unknown): void;
};

@Module({
  imports: [
    // CLS 모듈 설정 (Trace ID 관리용)

    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls: ClsLike, req: Request) => {
          // Trace ID를 CLS에 저장 (헤더에서 가져오거나 생성)
          const traceIdHeader =
            req.headers['x-trace-id'] ?? req.headers['x-request-id'];
          const traceId =
            typeof traceIdHeader === 'string' ? traceIdHeader : undefined;
          if (traceId !== undefined) {
            cls.set('traceId', traceId);
          }
        },
      },
    }),

    // 환경변수 모듈 설정
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV || 'local'}`, '.env'],
    }),

    // 스케줄링 모듈 설정
    ScheduleModule.forRoot(),

    // TypeORM 모듈 설정 (DB 연결)
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isProd = (process.env.NODE_ENV || 'development') === 'production';
        const enableQueryLog = !isProd && process.env.DB_QUERY_LOG === '1';

        return {
          logger: new TypeormWinstonLogger(enableQueryLog),
          logging: isProd
            ? ['error', 'warn']
            : enableQueryLog
              ? ['error', 'warn', 'query']
              : ['error', 'warn'],
          // warn-level slow query logging (ms)
          maxQueryExecutionTime: isProd ? 1000 : 300,
          type: 'postgres',
          host: configService.getOrThrow<string>('DB_HOST'),
          port: +configService.getOrThrow<number>('DB_PORT'),
          username: configService.getOrThrow<string>('DB_USERNAME'),
          password: configService.getOrThrow<string>('DB_PASSWORD'),
          database: configService.getOrThrow<string>('DB_DATABASE'),

          ssl: {
            rejectUnauthorized: false,
          },

          autoLoadEntities: true,
          synchronize: true, // 개발용으로만 true, 프로덕션에서는 false
        };
      },
    }),

    // HttpService(axios) outgoing logging (global)
    HttpLoggingModule,

    // Redis 모듈 글로벌 등록
    RedisModule.forRoot({
      config: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
        password: process.env.REDIS_PASSWORD,
        db: process.env.REDIS_DB ? Number(process.env.REDIS_DB) : 0,
      },
    }),

    MailModule,
    AuthModule,
    UserModule,
    StationsModule,
    RoutesModule,
    NavigationModule,
    TtsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
