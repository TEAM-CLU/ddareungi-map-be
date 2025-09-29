import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    description: '비밀번호를 재설정할 이메일 주소',
    example: 'user@example.com'
  })
  @IsNotEmpty({ message: '이메일은 필수입니다.' })
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다.' })
  email: string;

  @ApiProperty({
    description: '새로운 비밀번호 (8-255자)',
    example: 'newPassword123!'
  })
  @IsNotEmpty({ message: '새로운 비밀번호는 필수입니다.' })
  @IsString({ message: '새로운 비밀번호는 문자열이어야 합니다.' })
  @MinLength(8, { message: '새로운 비밀번호는 최소 8글자 이상이어야 합니다.' })
  @MaxLength(255, { message: '새로운 비밀번호는 최대 255글자 이하여야 합니다.' })
  newPassword: string;
}