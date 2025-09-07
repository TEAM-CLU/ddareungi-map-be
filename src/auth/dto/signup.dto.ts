import {
  IsString,
  IsEmail,
  MinLength,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsDateString,
} from 'class-validator';

export class SignUpDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @MinLength(8)
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsOptional()
  @IsIn(['male', 'female'])
  gender?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: Date;
}
