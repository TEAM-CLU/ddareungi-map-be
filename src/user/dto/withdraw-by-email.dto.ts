import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class WithdrawByEmailDto {
  @ApiProperty({
    description: '탈퇴(삭제)할 사용자 이메일',
    example: 'user@example.com',
  })
  @IsNotEmpty({ message: '이메일은 필수입니다.' })
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다.' })
  email: string;
}

