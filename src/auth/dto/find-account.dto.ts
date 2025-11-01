import { IsString, IsJWT } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FindAccountDto {
  @ApiProperty({
    description: '이메일 인증 후 받은 JWT 보안 토큰',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJwdXJwb3NlIjoiYWNjb3VudC1maW5kIiwiaWF0IjoxNjk4ODAxMjAwLCJleHAiOjE2OTg4MDEyNjB9.signature',
  })
  @IsString({ message: '보안 토큰은 문자열이어야 합니다.' })
  @IsJWT({ message: '유효한 JWT 토큰 형식이어야 합니다.' })
  securityToken: string;
}
