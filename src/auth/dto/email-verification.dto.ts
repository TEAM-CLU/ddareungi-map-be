import { IsEmail, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendVerificationEmailDto {
  @ApiProperty({
    description: '인증받을 이메일 주소',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: '올바른 이메일 주소를 입력해주세요.' })
  email: string;
}

export class VerifyEmailDto {
  @ApiProperty({
    description: '인증받을 이메일 주소',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: '올바른 이메일 주소를 입력해주세요.' })
  email: string;

  @ApiProperty({
    description: '6자리 인증 코드',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsString({ message: '인증 코드는 문자열이어야 합니다.' })
  @Length(6, 6, { message: '인증 코드는 6자리여야 합니다.' })
  @Matches(/^\d{6}$/, { message: '인증 코드는 6자리 숫자여야 합니다.' })
  verificationCode: string;
}

export class VerifyEmailResponseDto {
  @ApiProperty({
    description: '인증 성공 메시지',
    example: '이메일 인증이 완료되었습니다.',
  })
  message: string;

  @ApiProperty({
    description: '이메일 인증 여부',
    example: true,
  })
  isVerified: boolean;

  @ApiProperty({
    description: '보안 토큰 (암호화된 이메일 포함, find-account 요청 시 사용)',
    example: 'base64EncodedEncryptedEmail...',
  })
  securityToken: string;
}
