import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ExchangeTokenDto {
  @ApiProperty({
    description: 'PKCE code verifier',
    example: '3z9Q...verifier',
  })
  @IsString()
  @IsNotEmpty()
  codeVerifier: string;
}
