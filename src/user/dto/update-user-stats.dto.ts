import { IsNumber, IsPositive } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserStatsDto {
  @ApiProperty({
    description: '총 이동 거리 (미터 단위)',
    example: 125.5,
    minimum: 0,
  })
  @IsNumber({}, { message: '총 거리는 숫자여야 합니다.' })
  @IsPositive({ message: '총 거리는 양수여야 합니다.' })
  totalDistance: number;

  @ApiProperty({
    description: '총 이용 시간 (초 단위)',
    example: 480,
    minimum: 0,
  })
  @IsNumber({}, { message: '총 시간은 숫자여야 합니다.' })
  @IsPositive({ message: '총 시간은 양수여야 합니다.' })
  totalTime: number;

  @ApiProperty({
    description: '소모된 칼로리 (kcal)',
    example: 2150,
    minimum: 0,
  })
  @IsNumber({}, { message: '칼로리는 숫자여야 합니다.' })
  @IsPositive({ message: '칼로리는 양수여야 합니다.' })
  calories: number;

  @ApiProperty({
    description: '심은 나무 수 (그루)',
    example: 12,
    minimum: 0,
  })
  @IsNumber({}, { message: '심은 나무 수는 숫자여야 합니다.' })
  @IsPositive({ message: '심은 나무 수는 양수여야 합니다.' })
  plantingTree: number;

  @ApiProperty({
    description: '탄소 감축량 (kg)',
    example: 45.8,
    minimum: 0,
  })
  @IsNumber({}, { message: '탄소 감축량은 숫자여야 합니다.' })
  @IsPositive({ message: '탄소 감축량은 양수여야 합니다.' })
  carbonReduction: number;
}
