import { ApiProperty } from '@nestjs/swagger';

export class TtsMetricsCountersDto {
  @ApiProperty({ example: 12 })
  tts_chunk_synthesized_total: number;

  @ApiProperty({ example: 5 })
  tts_merged_created_total: number;

  @ApiProperty({ example: 18 })
  tts_merged_cache_hit_total: number;

  @ApiProperty({ example: 30 })
  tts_merged_request_total: number;

  @ApiProperty({ example: 22 })
  tts_merged_repeat_request_total: number;
}

export class TtsMetricsRatiosDto {
  @ApiProperty({ example: 0.7333 })
  tts_merged_repeat_request_ratio: number;
}

export class TtsMetricsSnapshotDto {
  @ApiProperty({ type: TtsMetricsCountersDto })
  counters: TtsMetricsCountersDto;

  @ApiProperty({ type: TtsMetricsRatiosDto })
  ratios: TtsMetricsRatiosDto;
}
