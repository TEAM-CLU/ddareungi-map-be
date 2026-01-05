import { Logger as NestLogger } from '@nestjs/common';
import type { Logger as TypeOrmLogger, QueryRunner } from 'typeorm';

export class TypeormWinstonLogger implements TypeOrmLogger {
  private readonly logger = new NestLogger('TypeORM');

  constructor(private readonly enableQueryLog: boolean) {}

  logQuery(query: string, _parameters?: unknown[], _queryRunner?: QueryRunner) {
    if (!this.enableQueryLog) return;
    // Avoid logging parameters to reduce risk of sensitive data exposure.
    this.logger.debug({
      message: '[DB] query',
      query,
    });
  }

  logQueryError(
    error: string | Error,
    query: string,
    _parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ) {
    const err = typeof error === 'string' ? new Error(error) : error;
    this.logger.error({
      message: '[DB] query error',
      query,
      error: {
        name: err.name,
        message: err.message,
        ...(err.stack ? { stack: err.stack } : {}),
      },
    });
  }

  logQuerySlow(
    time: number,
    query: string,
    _parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ) {
    this.logger.warn({
      message: '[DB] slow query',
      timeMs: time,
      query,
    });
  }

  logSchemaBuild(message: string, _queryRunner?: QueryRunner) {
    if (!this.enableQueryLog) return;
    this.logger.debug({ message: '[DB] schema', detail: message });
  }

  logMigration(message: string, _queryRunner?: QueryRunner) {
    this.logger.log({ message: '[DB] migration', detail: message });
  }

  log(
    level: 'log' | 'info' | 'warn',
    message: unknown,
    _queryRunner?: QueryRunner,
  ) {
    if (level === 'warn')
      this.logger.warn({ message: '[DB] warn', detail: message });
    else this.logger.log({ message: '[DB] info', detail: message });
  }
}
