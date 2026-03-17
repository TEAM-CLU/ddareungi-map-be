import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { createWinstonLogger } from './common/logger/winston.config';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { SentryInterceptor } from './common/interceptors/sentry.interceptor';
import { ClsService } from 'nestjs-cls';
import * as Sentry from '@sentry/nestjs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  buildSwaggerBasicAuthMiddleware,
  isSwaggerEnabled,
} from './common/swagger/swagger-basic-auth.util';

async function bootstrap() {
  const bootstrapLogger = new Logger('Bootstrap');

  // ConfigService를 먼저 가져와서 환경 변수 확인
  const tempApp = await NestFactory.createApplicationContext(AppModule, {
    logger: false, // 임시로 로거 비활성화 (Winston 설정 전)
    abortOnError: false,
  });
  const configService = tempApp.get(ConfigService);
  await tempApp.close();

  // Winston Logger 생성
  const winstonLogger = createWinstonLogger(configService);

  // Sentry 초기화 (에러 모니터링 전용, production에서만)
  const nodeEnv = configService.get<string>('NODE_ENV', 'local');
  const sentryDsn = configService.get<string>('SENTRY_DSN');
  if (nodeEnv === 'production' && sentryDsn) {
    const tracesSampleRate = Number(
      configService.get<string>('SENTRY_TRACES_SAMPLE_RATE', '0.1'),
    );

    Sentry.init({
      dsn: sentryDsn,
      environment: nodeEnv,
      tracesSampleRate: Number.isFinite(tracesSampleRate)
        ? tracesSampleRate
        : 0.1,
    });
  }

  // NestJS 앱 생성 (Winston Logger 사용)
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: winstonLogger,
    abortOnError: false,
  });

  // Global Interceptor 등록 (요청/응답 로깅)
  const clsService = app.get(ClsService);
  app.useGlobalInterceptors(new SentryInterceptor(configService, clsService));
  app.useGlobalInterceptors(new LoggingInterceptor(clsService));

  // helmet 임시 비활성화 - Swagger 테스트용
  // app.use(
  //   helmet({
  //     contentSecurityPolicy: {
  //       directives: {
  //         ...helmet.contentSecurityPolicy.getDefaultDirectives(),
  //         'script-src': ["'self'", "'unsafe-inline'"], // 인라인 스크립트 허용
  //         'style-src': ["'self'", "'unsafe-inline'"], // 인라인 스타일 허용
  //         'img-src': ["'self'", 'data:'], // 스웨거 UI 이미지 적용
  //       },
  //     },
  //     crossOriginOpenerPolicy: false, // COOP 헤더 비활성화
  //     crossOriginResourcePolicy: false, // CORP 헤더 비활성화
  //   }),
  // );

  app.enableCors({
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Trace-Id',
      'X-Request-Id',
    ],
  });

  // ValidationPipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // DTO에 정의되지 않은 속성은 자동으로 제거
      forbidNonWhitelisted: true, // DTO에 없는 값이 들어오면 요청 자체를 막음
      transform: true, // 요청에서 넘어온 자료들의 형변환을 자동으로 진행
    }),
  );

  // API documents (Swagger)
  const config = new DocumentBuilder()
    .setTitle('Ddareuni-Map API documents')
    .setDescription('따릉이맵 API 문서입니다.')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth', // This name here is important for matching up with @ApiBearerAuth() in your controller!
    )
    .addOAuth2({
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://nid.naver.com/oauth2.0/authorize',
          tokenUrl: 'https://nid.naver.com/oauth2.0/token',
          scopes: {},
        },
      },
    })
    .addOAuth2({
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://kauth.kakao.com/oauth/authorize',
          tokenUrl: 'https://kauth.kakao.com/oauth/token',
          scopes: {},
        },
      },
    })
    .addOAuth2({
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
          tokenUrl: 'https://oauth2.googleapis.com/token',
          scopes: {
            email: 'Access to your email address',
            profile: 'Access to your basic profile info',
          },
        },
      },
    })
    .build();

  if (isSwaggerEnabled(configService)) {
    const swaggerBasicAuthMiddleware =
      buildSwaggerBasicAuthMiddleware(configService);
    app.use('/api-docs', swaggerBasicAuthMiddleware);
    app.use('/api-docs-json', swaggerBasicAuthMiddleware);

    const document = SwaggerModule.createDocument(app, config);

    // Swagger 설정 옵션 추가 - HTTP를 사용하도록 강제
    SwaggerModule.setup('api-docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        // 상대 경로를 사용하여 현재 프로토콜/호스트를 따르도록 설정
        url: '/api-docs-json',
      },
      customSiteTitle: 'Ddareungi Map API',
      customCss: '.swagger-ui .topbar { display: none }', // 상단바 제거 (선택사항)
    });
  } else {
    bootstrapLogger.warn(
      'Swagger is disabled because SWAGGER_ADMIN_USERNAME or SWAGGER_ADMIN_PASSWORD is not configured.',
    );
  }

  const port = Number(configService.get<string>('PORT', '3000'));
  await app.listen(port);
}
void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[bootstrap] ${message}\n`);
  process.exit(1);
});
