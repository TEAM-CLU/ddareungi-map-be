import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  // CORS
  app.enableCors({
    origin: true, // 허용할 출처, 배포 시에 프론트엔드 도메인 주소로 지정
    credentials: true,
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
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  await app.listen(3000);
}
bootstrap();
