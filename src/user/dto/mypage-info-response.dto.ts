import { ApiProperty } from '@nestjs/swagger';

export class MyPageInfoResponseDto {
  @ApiProperty({
    description: '생년월일',
    example: '1990-01-01',
    nullable: true,
  })
  birthDate: string | null;

  @ApiProperty({
    description: '성별',
    example: 'male',
    nullable: true,
  })
  gender: string | null;

  @ApiProperty({
    description: '주소',
    example: '서울특별시 강남구',
    nullable: true,
  })
  address: string | null;

  @ApiProperty({
    description: '사용자 이름',
    example: '홍길동',
  })
  name: string;

  @ApiProperty({
    description: '사용자 이메일',
    example: 'user@example.com',
  })
  email: string;

  @ApiProperty({
    description: '총 이동 거리 (km)',
    example: 125.5,
    nullable: true,
  })
  totalDistance: number | null;

  @ApiProperty({
    description: '총 이용 시간 (분)',
    example: 480,
    nullable: true,
  })
  totalTime: number | null;

  @ApiProperty({
    description: '소모 칼로리 (kcal)',
    example: 2150,
    nullable: true,
  })
  calories: number | null;

  @ApiProperty({
    description: '식목 효과 (그루)',
    example: 12,
    nullable: true,
  })
  plantingTree: number | null;

  @ApiProperty({
    description: '탄소 절약량 (kg)',
    example: 45.8,
    nullable: true,
  })
  carbonReduction: number | null;

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
