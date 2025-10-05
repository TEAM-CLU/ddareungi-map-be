import { IsString, IsEmail, IsOptional, IsNotEmpty, IsIn, IsDateString, Length } from 'class-validator';
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

  @ApiProperty({ description: '성별', enum: ['M', 'F'] })
  @IsString()
  @IsIn(['M', 'F'])
  gender: string;

  @ApiProperty({ description: '생년월일', example: '1990-01-01' })
  @IsDateString()
  birthDate: string;

  @ApiProperty({ description: '주소', example: '서울특별시-강남구-역삼동' })
  @IsString()
  address: string;
}