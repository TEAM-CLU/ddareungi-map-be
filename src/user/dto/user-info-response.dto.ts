import { ApiProperty } from '@nestjs/swagger';

export class UserInfoResponseDto {
  @ApiProperty({
    description: '사용자 이름',
    example: '홍길동'
  })
  name: string;

  @ApiProperty({
    description: '생년월일',
    example: '1990-01-01'
  })
  birthDate: string;

  @ApiProperty({
    description: '성별 (M: 남성, F: 여성)',
    example: 'M'
  })
  gender: string;

  @ApiProperty({
    description: '주소',
    example: '서울특별시 강남구',
    nullable: true
  })
  address: string | null;
}