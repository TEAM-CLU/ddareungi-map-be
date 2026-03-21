import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsLatitude, IsLongitude, IsNumber, Min } from 'class-validator';

export class BenchmarkMapQueryDto {
  @ApiProperty({
    description: '지도 중심 위도',
    example: 37.630032,
  })
  @IsLatitude()
  latitude: number;

  @ApiProperty({
    description: '지도 중심 경도',
    example: 127.076508,
  })
  @IsLongitude()
  longitude: number;

  @ApiProperty({
    description: '조회 반경(m)',
    example: 1000,
  })
  @IsNumber()
  @Min(1)
  radius: number;
}

export class BenchmarkMapEndToEndDto extends BenchmarkMapQueryDto {
  @ApiProperty({
    description: '지도 조회 후 실시간 동기화 방식',
    enum: ['inline', 'batch', 'batch_parallel'],
    example: 'batch_parallel',
  })
  @IsIn(['inline', 'batch', 'batch_parallel'])
  syncStrategy: 'inline' | 'batch' | 'batch_parallel';
}
