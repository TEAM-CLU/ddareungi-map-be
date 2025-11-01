import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FindAccountRequestDto {
  @ApiProperty({
    description: '이메일 인증으로 받은 보안 토큰 (암호화된 이메일)',
    example: 'base64EncodedSecurityToken...',
  })
  @IsString({ message: '보안 토큰은 문자열이어야 합니다.' })
  securityToken: string;
}

export class FindAccountResponseDto {
  @ApiProperty({
    description: '계정 존재 여부',
    example: true,
  })
  isRegistered: boolean;

  @ApiProperty({
    description: '계정 유형',
    enum: ['소셜', '자체'],
    example: '소셜',
  })
  accountType: '소셜' | '자체';

  @ApiProperty({
    description: '프론트에 표시할 메시지',
    example: '이미 구글 계정으로 가입된 이메일입니다.',
  })
  message: string;
}
