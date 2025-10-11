import { ApiProperty } from '@nestjs/swagger';

export class UserStatsResponseDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 1
  })
  userId: number;

  @ApiProperty({
    description: '총 이용시간 (초 단위)',
    example: 7200
  })
  totalUsageTime: number;

  @ApiProperty({
    description: '총 이용거리 (미터 단위)',
    example: 25500.5
  })
  totalUsageDistance: number;

  @ApiProperty({
    description: '총 탄소발자국 감축량 (kg)',
    example: 125.8
  })
  totalCarbonFootprint: number;

  @ApiProperty({
    description: '총 심은 나무 수 (그루)',
    example: 45
  })
  totalTreesPlanted: number;

  @ApiProperty({
    description: '총 칼로리 소모량 (kcal)',
    example: 8750.5
  })
  totalCaloriesBurned: number;

  @ApiProperty({
    description: '마지막 업데이트 시간',
    example: '2025-10-11T12:34:56.789Z'
  })
  updatedAt: Date;
}