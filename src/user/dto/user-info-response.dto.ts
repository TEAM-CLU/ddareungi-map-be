import { ApiProperty } from '@nestjs/swagger';

export class UserInfoResponseDto {
  @ApiProperty({
    description: '사용자 이름',
    example: '홍길동',
  })
  name: string;

  @ApiProperty({
    description: '생년월일',
    example: '1990-01-01',
  })
  birthDate: string;

  @ApiProperty({
    description: '성별 (M: 남성, F: 여성)',
    example: 'M',
  })
  gender: string;

  @ApiProperty({
    description: '주소',
    example: '서울특별시 강남구',
    nullable: true,
    required: false,
  })
  address: string | null;

  @ApiProperty({
    description: '동의 일시',
    example: '2024-01-15T09:30:00Z',
    nullable: true,
  })
  consentedAt: Date | null;

  @ApiProperty({
    description: '필수 약관 동의 여부',
    example: true,
  })
  requiredAgreed: boolean;

  @ApiProperty({
    description: '선택 약관 동의 여부',
    example: false,
  })
  optionalAgreed: boolean;
}
