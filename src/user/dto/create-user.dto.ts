import {
  IsString,
  IsEmail,
  IsOptional,
  IsNotEmpty,
  IsIn,
  IsDateString,
  Length,
  IsBoolean,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ description: '소셜 UID', required: false })
  @IsOptional()
  @IsString()
  socialUid?: string;

  @ApiProperty({ description: '이메일 주소' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: '비밀번호' })
  @IsString()
  @Length(8, 255)
  password: string;

  @ApiProperty({ description: '사용자 이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '성별', enum: ['M', 'F', 'U'], required: false })
  @IsOptional()
  @IsString()
  @IsIn(['M', 'F', 'U'])
  gender?: string | null;

  @ApiProperty({
    description: '생년월일 (YYYY-MM-DD 형식)',
    example: '1990-03-27',
    required: false,
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: '생년월일은 YYYY-MM-DD 형식이어야 합니다.',
  })
  birthDate?: string | null;

  @ApiProperty({
    description: '주소',
    example: '서울특별시-강남구-역삼동',
    required: false,
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({
    description: '동의 시각',
    example: '2024-01-01T00:00:00Z',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  consentedAt?: string;

  @ApiProperty({
    description: '필수 약관 동의 여부',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  requiredAgreed?: boolean;

  @ApiProperty({
    description: '선택 약관 동의 여부',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  optionalAgreed?: boolean;
}
