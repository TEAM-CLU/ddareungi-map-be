import { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { utilities, WinstonModule } from 'nest-winston';

/**
 * KST(Asia/Seoul) 기준 타임스탬프 생성
 * - 서버/컨테이너의 TZ 설정과 무관하게 로그에 KST로 기록되도록 강제
 * - 포맷: YYYY-MM-DD HH:mm:ss.SSS
 */
function kstTimestamp(date: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = dtf.formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '00';

  const yyyy = get('year');
  const mm = get('month');
  const dd = get('day');
  const hh = get('hour');
  const mi = get('minute');
  const ss = get('second');
  const ms = String(date.getMilliseconds()).padStart(3, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${ms}`;
}

/**
 * 민감 정보(PII) 마스킹을 위한 필드 목록
 */
const SENSITIVE_FIELDS = [
  'password',
  'accessToken',
  'refreshToken',
  'authorization',
];

/**
 * 객체 내의 민감 정보를 마스킹하는 재귀 함수
 */
function maskSensitiveData(obj: unknown, depth = 0): unknown {
  // 최대 깊이 제한 (무한 재귀 방지)
  if (depth > 10) {
    return '[Max Depth Reached]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  // 문자열인 경우
  if (typeof obj === 'string') {
    return obj;
  }

  // 배열인 경우
  if (Array.isArray(obj)) {
    return obj.map((item) => maskSensitiveData(item, depth + 1));
  }

  // 객체인 경우
  if (typeof obj === 'object') {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();

      // 민감 필드인 경우 마스킹
      if (
        SENSITIVE_FIELDS.some((field) => lowerKey.includes(field.toLowerCase()))
      ) {
        masked[key] = '***';
      } else {
        masked[key] = maskSensitiveData(value, depth + 1);
      }
    }
    return masked;
  }

  return obj;
}

/**
 * 민감 정보를 마스킹하는 커스텀 포맷터
 */
const maskSensitiveFormat = winston.format((info) => {
  // message가 객체인 경우 마스킹 처리
  if (typeof info.message === 'object') {
    info.message = maskSensitiveData(info.message);
  }

  // meta 객체가 있는 경우 마스킹 처리
  if (info.meta && typeof info.meta === 'object') {
    info.meta = maskSensitiveData(info.meta);
  }

  // 추가 컨텍스트 정보 마스킹
  if (info.context && typeof info.context === 'object') {
    info.context = maskSensitiveData(info.context);
  }

  return info;
});

/**
 * JSON 포맷터 (Production용)
 */
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: () => kstTimestamp() }),
  winston.format.errors({ stack: true }),
  maskSensitiveFormat(),
  winston.format.json(),
);

/**
 * NestLike 포맷터 (Development용)
 */
const nestLikeFormat = winston.format.combine(
  winston.format.timestamp({ format: () => kstTimestamp() }),
  winston.format.errors({ stack: true }),
  maskSensitiveFormat(),
  utilities.format.nestLike('DdareungiMap', {
    prettyPrint: true,
    colors: true,
  }),
);

/**
 * Winston 로거 설정 팩토리
 */
export function createWinstonLogger(
  configService: ConfigService,
): LoggerService {
  const nodeEnv = configService.get<string>('NODE_ENV', 'local');
  const isProduction = nodeEnv === 'production';

  // 로그 레벨 설정
  const logLevel =
    configService.get<string>('LOG_LEVEL') ??
    (isProduction ? 'info' : 'debug');

  // 기본 포맷 선택
  const defaultFormat = isProduction ? jsonFormat : nestLikeFormat;

  // Transport 배열
  const transports: winston.transport[] = [];

  // 콘솔 출력 (모든 환경)
  transports.push(
    new winston.transports.Console({
      level: logLevel,
      format: defaultFormat,
    }),
  );

  // Production 환경에서만 파일 로깅
  if (isProduction) {
    const logsDir = 'logs';

    // 일반 로그 파일 (14일 보관)
    transports.push(
      new DailyRotateFile({
        filename: `${logsDir}/application-%DATE%.log`,
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        format: jsonFormat,
        level: logLevel,
        zippedArchive: true, // Gzip 압축
      }),
    );

    // 에러 로그 파일 (30일 보관, error 레벨만)
    transports.push(
      new DailyRotateFile({
        filename: `${logsDir}/error-%DATE%.log`,
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '30d',
        format: jsonFormat,
        level: 'error',
        zippedArchive: true, // Gzip 압축
      }),
    );
  }

  // Winston 인스턴스 생성
  const winstonLogger = winston.createLogger({
    level: logLevel,
    format: defaultFormat,
    transports,
    exitOnError: false, // 에러 발생 시 프로세스 종료하지 않음
  });

  // NestJS Winston 모듈로 래핑
  return WinstonModule.createLogger({
    instance: winstonLogger,
  });
}
