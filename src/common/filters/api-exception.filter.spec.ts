import { HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter', () => {
  const createResponse = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return { status, json };
  };

  const createHost = (response: {
    status: jest.Mock;
    json: jest.Mock;
  }): ArgumentsHost =>
    ({
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    }) as unknown as ArgumentsHost;

  it('wraps string HttpException messages', () => {
    const filter = new ApiExceptionFilter();
    const response = createResponse();

    filter.catch(
      new HttpException('잘못된 요청입니다.', HttpStatus.BAD_REQUEST),
      createHost(response),
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: '잘못된 요청입니다.',
    });
  });

  it('preserves structured HttpException payloads', () => {
    const filter = new ApiExceptionFilter();
    const response = createResponse();

    filter.catch(
      new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          message: '권한이 없습니다.',
        },
        HttpStatus.UNAUTHORIZED,
      ),
      createHost(response),
    );

    expect(response.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.UNAUTHORIZED,
      message: '권한이 없습니다.',
    });
  });

  it('maps unknown exceptions to internal server errors', () => {
    const filter = new ApiExceptionFilter();
    const response = createResponse();

    filter.catch(new Error('boom'), createHost(response));

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(response.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: '서버 내부 오류가 발생했습니다.',
    });
  });
});
