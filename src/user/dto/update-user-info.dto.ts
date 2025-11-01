import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsIn,
  IsBoolean,
  IsDateString,
} from 'class-validator';

export class UpdateUserInfoDto {
  @ApiProperty({
    description: '사용자 이름',
    example: '홍길동',
  })
  @IsNotEmpty({ message: '이름은 필수입니다.' })
  @IsString({ message: '이름은 문자열이어야 합니다.' })
  name: string;

  @ApiProperty({
    description: '생년월일 (YYYY-MM-DD 형식)',
    example: '1990-01-01',
  })
  @IsNotEmpty({ message: '생년월일은 필수입니다.' })
  @IsString({ message: '생년월일은 문자열이어야 합니다.' })
  birthDate: string;

  @ApiProperty({
    description: '성별 (M: 남성, F: 여성)',
    example: 'M',
    enum: ['M', 'F'],
  })
  @IsNotEmpty({ message: '성별은 필수입니다.' })
  @IsString({ message: '성별은 문자열이어야 합니다.' })
  @IsIn(['M', 'F'], { message: '성별은 M(남성) 또는 F(여성)이어야 합니다.' })
  gender: string;

  @ApiProperty({
    description: '주소',
    example: '서울특별시-강남구-역삼동',
    required: false,
  })
  @IsOptional()
  @IsString({ message: '주소는 문자열이어야 합니다.' })
  address?: string;

  @ApiProperty({
    description: '동의 일시',
    example: '2024-01-15T09:30:00Z',
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
