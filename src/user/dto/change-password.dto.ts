import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    description: '현재 비밀번호',
    example: 'currentPassword123!'
  })
  @IsNotEmpty({ message: '현재 비밀번호는 필수입니다.' })
  @IsString({ message: '현재 비밀번호는 문자열이어야 합니다.' })
  currentPassword: string;

  @ApiProperty({
    description: '새로운 비밀번호 (8-255자)',
    example: 'newPassword456!'
  })
  @IsNotEmpty({ message: '새로운 비밀번호는 필수입니다.' })
  @IsString({ message: '새로운 비밀번호는 문자열이어야 합니다.' })
  @MinLength(8, { message: '새로운 비밀번호는 최소 8글자 이상이어야 합니다.' })
  @MaxLength(255, { message: '새로운 비밀번호는 최대 255글자 이하여야 합니다.' })
  newPassword: string;
}