import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SuccessResponseDto, ErrorResponseDto } from '../api-response.dto';
import { BenchmarkResetDto } from './dto/benchmark-reset.dto';
import { BenchmarkMetricsService } from './benchmark-metrics.service';
import {
  BenchmarkMapEndToEndDto,
  BenchmarkMapQueryDto,
} from './dto/benchmark-map-scenario.dto';
import { BenchmarkNavigationScenarioDto } from './dto/benchmark-navigation-scenario.dto';
import { BenchmarkScenarioService } from './benchmark-scenario.service';
import { AdminProtected } from '../decorators/admin-protected.decorator';
import {
  getAdminRateLimit,
  getBenchmarkRateLimit,
} from '../rate-limit/rate-limit.util';

@ApiTags('내부 벤치마크 (internal-benchmark)')
@AdminProtected()
@Throttle({ default: getAdminRateLimit() })
@Controller('internal/benchmark')
export class BenchmarkController {
  constructor(
    private readonly benchmarkMetricsService: BenchmarkMetricsService,
    private readonly benchmarkScenarioService: BenchmarkScenarioService,
  ) {}

  private ensureEnabled(): void {
    if (!this.benchmarkMetricsService.enabled) {
      throw new NotFoundException('Benchmark metrics are disabled');
    }
  }

  @Get('snapshot')
  @ApiOperation({
    summary: '벤치마크 메트릭 스냅샷 조회',
    description: '현재 누적된 벤치마크 카운터를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '메트릭 조회 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '벤치마크 모드 비활성화',
    type: ErrorResponseDto,
  })
  snapshot(): SuccessResponseDto<Record<string, number>> {
    this.ensureEnabled();
    return SuccessResponseDto.create(
      '벤치마크 메트릭 조회 성공',
      this.benchmarkMetricsService.snapshot(),
    );
  }

  @Post('reset')
  @ApiOperation({
    summary: '벤치마크 메트릭 초기화',
    description:
      '벤치마크 카운터를 초기화하고 옵션에 따라 Redis/Supabase 캐시도 정리합니다.',
  })
  @ApiBody({ type: BenchmarkResetDto, required: false })
  @ApiResponse({
    status: 200,
    description: '초기화 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '벤치마크 모드 비활성화',
    type: ErrorResponseDto,
  })
  async reset(@Body() body: BenchmarkResetDto = {}): Promise<
    SuccessResponseDto<{
      enabled: boolean;
      counters: Record<string, number>;
      deletedRedisKeys: number;
      deletedStorageFiles: number;
    }>
  > {
    this.ensureEnabled();

    const result = await this.benchmarkMetricsService.reset(body);
    return SuccessResponseDto.create('벤치마크 메트릭 초기화 성공', result);
  }

  @Post('scenarios/map-area/query')
  @Throttle({ default: getBenchmarkRateLimit() })
  @ApiOperation({
    summary: '벤치마크용 지도 조회 시나리오',
    description: 'DB 기반 지도 조회만 수행하는 벤치마크 전용 시나리오입니다.',
  })
  @ApiBody({ type: BenchmarkMapQueryDto })
  @ApiResponse({
    status: 200,
    description: '지도 조회 시나리오 실행 성공',
    type: SuccessResponseDto,
  })
  runMapQueryScenario(@Body() body: BenchmarkMapQueryDto): Promise<
    SuccessResponseDto<{
      stationCount: number;
      stationIds: string[];
      stationNumbers: string[];
    }>
  > {
    this.ensureEnabled();

    return this.benchmarkScenarioService
      .runMapQueryScenario(body)
      .then((result) =>
        SuccessResponseDto.create('지도 조회 시나리오 실행 성공', result),
      );
  }

  @Post('scenarios/map-area/end-to-end')
  @Throttle({ default: getBenchmarkRateLimit() })
  @ApiOperation({
    summary: '벤치마크용 지도 조회 + 실시간 동기화 시나리오',
    description:
      '지도 조회 후 inline 또는 batch 방식으로 실시간 동기화를 수행합니다.',
  })
  @ApiBody({ type: BenchmarkMapEndToEndDto })
  @ApiResponse({
    status: 200,
    description: '지도 조회 end-to-end 시나리오 실행 성공',
    type: SuccessResponseDto,
  })
  runMapEndToEndScenario(@Body() body: BenchmarkMapEndToEndDto): Promise<
    SuccessResponseDto<{
      stationCount: number;
      stationIds: string[];
      stationNumbers: string[];
    }>
  > {
    this.ensureEnabled();

    return this.benchmarkScenarioService
      .runMapEndToEndScenario(body)
      .then((result) =>
        SuccessResponseDto.create(
          '지도 조회 end-to-end 시나리오 실행 성공',
          result,
        ),
      );
  }

  @Post('scenarios/navigation/start')
  @Throttle({ default: getBenchmarkRateLimit() })
  @ApiOperation({
    summary: '벤치마크용 경로 생성 + 네비게이션 시작 시나리오',
    description:
      '경로를 생성한 뒤 첫 번째 routeId로 네비게이션을 시작해 TTS 생성 흐름을 유도합니다.',
  })
  @ApiBody({ type: BenchmarkNavigationScenarioDto })
  @ApiResponse({
    status: 200,
    description: '네비게이션 시작 시나리오 실행 성공',
    type: SuccessResponseDto,
  })
  runNavigationScenario(@Body() body: BenchmarkNavigationScenarioDto): Promise<
    SuccessResponseDto<{
      routeId: string;
      route: unknown;
      navigation: unknown;
    }>
  > {
    this.ensureEnabled();

    return this.benchmarkScenarioService
      .runNavigationScenario(body)
      .then((result) =>
        SuccessResponseDto.create('네비게이션 시작 시나리오 실행 성공', result),
      );
  }
}
