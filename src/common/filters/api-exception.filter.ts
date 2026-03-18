import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ErrorResponseDto } from '../api-response.dto';

type ExceptionResponse = {
  statusCode?: unknown;
  message?: unknown;
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        response
          .status(status)
          .json(ErrorResponseDto.create(status, exceptionResponse));
        return;
      }

      const parsed = exceptionResponse as ExceptionResponse;
      const statusCode =
        typeof parsed.statusCode === 'number' ? parsed.statusCode : status;
      const message =
        typeof parsed.message === 'string' || Array.isArray(parsed.message)
          ? parsed.message
          : exception.message;

      response
        .status(status)
        .json(ErrorResponseDto.create(statusCode, message));
      return;
    }

    const message =
      exception instanceof Error ? exception.message : 'Internal server error';
    const stack = exception instanceof Error ? exception.stack : undefined;
    this.logger.error(message, stack);

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '서버 내부 오류가 발생했습니다.',
        ),
      );
  }
}
