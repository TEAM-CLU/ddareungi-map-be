import {
  IsString,
  IsEmail,
  MinLength,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsDateString,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail({}, { message: '올바른 이메일 형식을 입력해주세요.' })
  @IsNotEmpty({ message: '이메일은 필수 입력 항목입니다.' })
  email: string;

  @IsString()
  @MinLength(8, { message: '비밀번호는 최소 8자 이상이어야 합니다.' })
  @IsNotEmpty({ message: '비밀번호는 필수 입력 항목입니다.' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: '이름은 필수 입력 항목입니다.' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: '전화번호는 필수 입력 항목입니다.' })
  phoneNumber: string;

  @IsOptional()
  @IsIn(['male', 'female'])
  gender?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: Date;
}
