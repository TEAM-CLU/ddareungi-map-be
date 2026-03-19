import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SuccessResponseDto } from '../common/api-response.dto';
import { AdminProtected } from '../common/decorators/admin-protected.decorator';
import { getAdminRateLimit } from '../common/rate-limit/rate-limit.util';
import { TtsMetricsSnapshotDto } from './dto/tts-metrics.dto';
import { TtsMetricsService } from './tts-metrics.service';

@ApiTags('내부 TTS (internal-tts)')
@AdminProtected()
@Throttle({ default: getAdminRateLimit() })
@Controller('internal/tts')
export class InternalTtsController {
  constructor(private readonly ttsMetricsService: TtsMetricsService) {}

  @Get('metrics')
  @ApiOperation({
    summary: 'TTS 운영 메트릭 조회',
    description: 'always-on TTS 운영 메트릭 카운터와 비율을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'TTS 운영 메트릭 조회 성공',
    type: SuccessResponseDto,
  })
  async getMetrics(): Promise<SuccessResponseDto<TtsMetricsSnapshotDto>> {
    return SuccessResponseDto.create(
      'TTS 운영 메트릭 조회 성공',
      await this.ttsMetricsService.snapshot(),
    );
  }
}
