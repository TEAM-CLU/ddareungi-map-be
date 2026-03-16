import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class BenchmarkResetDto {
  @ApiProperty({
    description: '메트릭 카운터만 초기화할지, 캐시도 함께 비울지 여부',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  clearCaches?: boolean;

  @ApiProperty({
    description: 'Redis 캐시(tts, navigation, route) 삭제 여부',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  clearRedisCaches?: boolean;

  @ApiProperty({
    description: 'Supabase TTS 스토리지 삭제 여부',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  clearStorageCaches?: boolean;
}
