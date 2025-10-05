import { ApiProperty } from '@nestjs/swagger';

// 성공 응답
export class SuccessResponseDto<T = any> {
  @ApiProperty({ description: '응답 상태 코드', example: 200 })
  statusCode: number;

  @ApiProperty({ description: '응답 메시지' })
  message: string;

  @ApiProperty({ description: '응답 데이터' })
  data: T;

  constructor(statusCode: number, message: string, data: T) {
    this.statusCode = statusCode;
    this.message = message;
    this.data = data;
  }

  static create<T>(message: string, data: T): SuccessResponseDto<T> {
    return new SuccessResponseDto(200, message, data);
  }
}

// 실패 응답
export class ErrorResponseDto {
  @ApiProperty({ description: '응답 상태 코드', example: 400 })
  statusCode: number;

  @ApiProperty({ description: '에러 메시지' })
  message: string;

  constructor(statusCode: number, message: string) {
    this.statusCode = statusCode;
    this.message = message;
  }

  static create(statusCode: number, message: string): ErrorResponseDto {
    return new ErrorResponseDto(statusCode, message);
  }
}
