import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  HttpStatus,
  Logger,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { StationSyncService } from './services/station-sync.service';
import { StationManagementService } from './services/station-management.service';
import { StationRealtimeService } from './services/station-realtime.service';
import { StationBatchRealtimeSyncService } from './services/station-batch-realtime-sync.service';
import { StationRequestValidationService } from './services/station-request-validation.service';
import { StationReadFacadeService } from './services/station-read-facade.service';
import { StationResponseDto } from './dto/station-api.dto';
import {
  CreateStationDto,
  NearbyStationResponseDto,
  StationNumbersDto,
} from './dto/station-api.dto';
import {
  DeleteAllResult,
  GeoJsonResponse,
} from './interfaces/station.interfaces';
import {
  SuccessResponseDto,
  ErrorResponseDto,
} from '../common/api-response.dto';
import {
  ANALYTICS_EVENT_API_OPERATION_RESULT,
  ANALYTICS_EVENT_STATION_SEARCH,
  getErrorType,
  getHttpStatusFromError,
  toRadiusBucket,
  toResultCountBucket,
} from '../analytics/analytics.constants';
import { AnalyticsIdentityResolver } from '../analytics/analytics-identity.resolver';
import { AnalyticsService } from '../analytics/analytics.service';
import type { AnalyticsRequest } from '../analytics/analytics.types';
import { AdminProtected } from '../common/decorators/admin-protected.decorator';
import { getAdminRateLimit } from '../common/rate-limit/rate-limit.util';

@ApiTags('대여소 (stations)')
@Controller('stations')
export class StationsController {
  private readonly logger = new Logger(StationsController.name);

  constructor(
    private readonly stationSyncService: StationSyncService,
    private readonly stationManagementService: StationManagementService,
    private readonly stationRealtimeService: StationRealtimeService,
    private readonly stationBatchRealtimeSyncService: StationBatchRealtimeSyncService,
    private readonly stationRequestValidationService: StationRequestValidationService,
    private readonly stationReadFacadeService: StationReadFacadeService,
    private readonly analyticsService: AnalyticsService,
    private readonly analyticsIdentityResolver: AnalyticsIdentityResolver,
  ) {}

  private getStationResultCount(
    data: NearbyStationResponseDto[] | GeoJsonResponse,
  ): number {
    return Array.isArray(data) ? data.length : data.features.length;
  }

  @Post('sync')
  @AdminProtected()
  @Throttle({ default: getAdminRateLimit() })
  @ApiOperation({
    summary: '서울시 API로부터 대여소 데이터 동기화',
    description:
      '서울시 공공자전거 대여소 정보 API를 호출하여 모든 대여소 데이터를 DB에 저장합니다. 기존 데이터는 업데이트하고, 새로운 데이터는 생성합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '동기화 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async syncStations(): Promise<SuccessResponseDto<null>> {
    this.logger.log('수동 대여소 동기화 요청');
    await this.stationSyncService.handleWeeklySync();
    return SuccessResponseDto.create(
      '대여소 동기화가 성공적으로 완료되었습니다.',
      null,
    );
  }

  @Post('realtime-sync')
  @AdminProtected()
  @Throttle({ default: getAdminRateLimit() })
  @ApiOperation({
    summary: '전체 대여소 실시간 대여정보 동기화',
    description:
      '서울시 공공자전거 실시간 대여정보 API를 호출하여 현재 DB에 존재하는 모든 대여소의 자전거 수, 거치대 수, 상태(status)를 최신화합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '전체 대여소 실시간 동기화 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async syncAllStationsRealtimeInfo(): Promise<SuccessResponseDto<object>> {
    this.logger.log('전체 대여소 실시간 대여정보 동기화 요청');
    const result =
      await this.stationRealtimeService.syncAllStationsRealtimeInfo();
    return SuccessResponseDto.create(
      `전체 대여소 실시간 대여정보 동기화가 완료되었습니다. (성공: ${result.successCount}개, 실패: ${result.failureCount}개)`,
      {
        successCount: result.successCount,
        failureCount: result.failureCount,
        details: result.details,
      },
    );
  }

  @Post('realtime-sync/batch')
  @Throttle({ default: getAdminRateLimit() })
  @ApiOperation({
    summary: '특정 대여소(들) 실시간 대여정보 동기화',
    description:
      '지정한 대여소 번호(stationNumbers) 목록에 대해 실시간 대여정보를 동기화합니다.',
  })
  @ApiBody({
    description: '부분 동기화할 대여소 번호(number) 목록 예시',
    schema: {
      type: 'object',
      properties: {
        stationNumbers: {
          type: 'array',
          items: { type: 'string' },
          description: '동기화할 대여소 번호 목록',
          example: [
            '01611',
            '02914',
            '01608',
            '01693',
            '02915',
            '01655',
            '04041',
            '05317',
            '04008',
            '04025',
            '05319',
            '05331',
            '02910',
            '05341',
            '02902',
            '02901',
            '04044',
            '01616',
            '02912',
            '04007',
            '01640',
            '05323',
          ],
        },
      },
      required: ['stationNumbers'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '특정 대여소 실시간 동기화 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async syncBatchStationsRealtimeInfo(
    @Body() body: StationNumbersDto,
  ): Promise<SuccessResponseDto<object>> {
    const { successCount, failureCount } =
      await this.stationBatchRealtimeSyncService.syncByStationNumbers(
        body.stationNumbers,
      );

    return SuccessResponseDto.create(
      `부분 대여소 실시간 대여정보 동기화가 완료되었습니다. (성공: ${successCount}개, 실패: ${failureCount}개)`,
      {
        successCount,
        failureCount,
      },
    );
  }

  @Get('nearby')
  @ApiOperation({
    summary: '가장 가까운 대여소 3개 검색',
    description:
      '지정된 위치 기준으로 가장 가까운 대여소 3개를 거리순으로 조회합니다. format=geojson 옵션으로 GeoJSON 형태로도 조회 가능합니다.',
  })
  @ApiQuery({
    name: 'latitude',
    description: '검색할 위도 (WGS84)',
    type: Number,
    example: 37.630032,
  })
  @ApiQuery({
    name: 'longitude',
    description: '검색할 경도 (WGS84)',
    type: Number,
    example: 127.076508,
  })
  @ApiQuery({
    name: 'format',
    description: '응답 포맷 (json 또는 geojson)',
    enum: ['json', 'geojson'],
    required: false,
    example: 'json',
  })
  @ApiResponse({
    status: 200,
    description: '가장 가까운 대여소 3개 조회 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 파라미터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async getNearbyStations(
    @Query('latitude') latitude: number,
    @Query('longitude') longitude: number,
    @Query('format') format: 'json' | 'geojson' = 'json',
    @Req() request: AnalyticsRequest,
  ): Promise<SuccessResponseDto<NearbyStationResponseDto[] | GeoJsonResponse>> {
    const startedAt = Date.now();
    const identity = this.analyticsIdentityResolver.resolve(request);

    try {
      const validated =
        this.stationRequestValidationService.validateCoordinates(
          latitude,
          longitude,
        );
      const result = await this.stationReadFacadeService.getNearbyStations(
        validated.latitude,
        validated.longitude,
        format,
      );

      const resultCount = this.getStationResultCount(result.data);
      this.analyticsService.trackEvent({
        name: ANALYTICS_EVENT_STATION_SEARCH,
        identity,
        params: {
          search_type: 'nearby',
          format,
          result_count_bucket: toResultCountBucket(resultCount),
          auth_state: identity.authState,
        },
      });
      this.analyticsService.trackEvent({
        name: ANALYTICS_EVENT_API_OPERATION_RESULT,
        identity,
        params: {
          feature_area: 'station_search',
          operation_name: 'get_nearby_stations',
          outcome: 'success',
          duration_ms: Date.now() - startedAt,
          http_status: 200,
          auth_state: identity.authState,
        },
      });

      return SuccessResponseDto.create(result.message, result.data);
    } catch (error) {
      this.analyticsService.trackEvent({
        name: ANALYTICS_EVENT_API_OPERATION_RESULT,
        identity,
        params: {
          feature_area: 'station_search',
          operation_name: 'get_nearby_stations',
          outcome: 'error',
          duration_ms: Date.now() - startedAt,
          http_status: getHttpStatusFromError(error),
          error_type: getErrorType(error),
          auth_state: identity.authState,
        },
      });
      throw error;
    }
  }

  @Get('map-area')
  @ApiOperation({
    summary: '지도 영역 내 대여소 조회',
    description:
      '지정된 중심점과 반경 내에 있는 모든 대여소를 거리순으로 조회합니다. 지도 화면에 표시할 대여소 목록을 가져올 때 사용합니다. format=geojson 옵션으로 GeoJSON 형태로도 조회 가능합니다.',
  })
  @ApiQuery({
    name: 'latitude',
    description: '중심점 위도 (WGS84)',
    type: Number,
    example: 37.630032,
  })
  @ApiQuery({
    name: 'longitude',
    description: '중심점 경도 (WGS84)',
    type: Number,
    example: 127.076508,
  })
  @ApiQuery({
    name: 'radius',
    description: '검색 반경 (미터)',
    type: Number,
    example: 1000,
  })
  @ApiQuery({
    name: 'format',
    description: '응답 포맷 (json 또는 geojson)',
    enum: ['json', 'geojson'],
    required: false,
    example: 'json',
  })
  @ApiResponse({
    status: 200,
    description: '지도 영역 내 대여소 조회 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 파라미터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async getStationsWithinRadius(
    @Query('latitude') latitude: number,
    @Query('longitude') longitude: number,
    @Query('radius') radius: number,
    @Query('format') format: 'json' | 'geojson' = 'json',
    @Req() request: AnalyticsRequest,
  ): Promise<SuccessResponseDto<NearbyStationResponseDto[] | GeoJsonResponse>> {
    const startedAt = Date.now();
    const identity = this.analyticsIdentityResolver.resolve(request);

    try {
      const validated =
        this.stationRequestValidationService.validateCoordinatesWithRadius(
          latitude,
          longitude,
          radius,
        );
      const result =
        await this.stationReadFacadeService.getStationsWithinRadius(
          validated.latitude,
          validated.longitude,
          validated.radius,
          format,
        );

      const resultCount = this.getStationResultCount(result.data);
      this.analyticsService.trackEvent({
        name: ANALYTICS_EVENT_STATION_SEARCH,
        identity,
        params: {
          search_type: 'map_area',
          format,
          radius_bucket: toRadiusBucket(validated.radius),
          result_count_bucket: toResultCountBucket(resultCount),
          auth_state: identity.authState,
        },
      });
      this.analyticsService.trackEvent({
        name: ANALYTICS_EVENT_API_OPERATION_RESULT,
        identity,
        params: {
          feature_area: 'station_search',
          operation_name: 'get_stations_within_radius',
          outcome: 'success',
          duration_ms: Date.now() - startedAt,
          http_status: 200,
          auth_state: identity.authState,
        },
      });

      return SuccessResponseDto.create(result.message, result.data);
    } catch (error) {
      this.analyticsService.trackEvent({
        name: ANALYTICS_EVENT_API_OPERATION_RESULT,
        identity,
        params: {
          feature_area: 'station_search',
          operation_name: 'get_stations_within_radius',
          outcome: 'error',
          duration_ms: Date.now() - startedAt,
          http_status: getHttpStatusFromError(error),
          error_type: getErrorType(error),
          auth_state: identity.authState,
        },
      });
      throw error;
    }
  }

  @Get()
  @ApiOperation({
    summary: '모든 대여소 조회',
    description:
      '등록된 모든 대여소 정보를 조회합니다. format=geojson 옵션으로 GeoJSON 형태로도 조회 가능합니다.',
  })
  @ApiQuery({
    name: 'format',
    description: '응답 포맷 (json 또는 geojson)',
    enum: ['json', 'geojson'],
    required: false,
    example: 'json',
  })
  @ApiResponse({
    status: 200,
    description: '모든 대여소 조회 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async findAll(
    @Query('format') format: 'json' | 'geojson' = 'json',
  ): Promise<SuccessResponseDto<StationResponseDto[] | GeoJsonResponse>> {
    const result = await this.stationReadFacadeService.getAllStations(format);
    return SuccessResponseDto.create(result.message, result.data);
  }

  @Get(':number')
  @ApiOperation({
    summary: '대여소 상세 조회 (실시간 정보 + 거리 + 주소 포함)',
    description:
      '대여소 번호로 특정 대여소의 상세 정보를 조회하고, 실시간 대여 정보를 업데이트한 후 반환합니다. 현재 위치가 제공되면 거리도 함께 계산됩니다.',
  })
  @ApiParam({
    name: 'number',
    description: '대여소 번호',
    example: '01611',
  })
  @ApiQuery({
    name: 'format',
    description: '응답 포맷 (json 또는 geojson)',
    enum: ['json', 'geojson'],
    required: false,
    example: 'json',
  })
  @ApiQuery({
    name: 'latitude',
    description: '현재 위치의 위도 (거리 계산용, 선택사항)',
    type: Number,
    required: false,
    example: 37.630032,
  })
  @ApiQuery({
    name: 'longitude',
    description: '현재 위치의 경도 (거리 계산용, 선택사항)',
    type: Number,
    required: false,
    example: 127.076508,
  })
  @ApiResponse({
    status: 200,
    description: '대여소 상세 조회 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '대여소를 찾을 수 없습니다.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async findOne(
    @Param('number') number: string,
    @Query('format') format: 'json' | 'geojson' = 'json',
    @Query('latitude') latitude?: number,
    @Query('longitude') longitude?: number,
  ): Promise<SuccessResponseDto<NearbyStationResponseDto | GeoJsonResponse>> {
    const validatedOptionalCoordinates =
      this.stationRequestValidationService.validateOptionalCoordinates(
        latitude,
        longitude,
      );
    const result = await this.stationReadFacadeService.getStationDetail({
      number,
      format,
      latitude: validatedOptionalCoordinates.latitude,
      longitude: validatedOptionalCoordinates.longitude,
    });

    return SuccessResponseDto.create(result.message, result.data);
  }

  @Post()
  @AdminProtected()
  @Throttle({ default: getAdminRateLimit() })
  @ApiOperation({
    summary: '대여소 생성',
    description:
      '새로운 대여소를 수동으로 생성합니다. 좌표 정보와 기본 정보가 필요합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '대여소 생성 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async create(
    @Body() createStationDto: CreateStationDto,
  ): Promise<SuccessResponseDto<StationResponseDto>> {
    const station =
      await this.stationManagementService.create(createStationDto);

    return new SuccessResponseDto(
      HttpStatus.CREATED,
      '대여소가 성공적으로 생성되었습니다.',
      station,
    );
  }

  @Delete('confirm')
  @AdminProtected()
  @Throttle({ default: getAdminRateLimit() })
  @ApiOperation({
    summary: '모든 대여소 삭제 (관리자용)',
    description:
      '모든 대여소를 영구적으로 삭제합니다. 매우 위험한 작업이므로 확인 키가 필요합니다.',
  })
  @ApiQuery({
    name: 'confirmKey',
    description: '삭제 확인 키 (DELETE_ALL_STATIONS_CONFIRM)',
    type: String,
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: '모든 대여소 삭제 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 확인 키',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async removeAll(
    @Query('confirmKey') confirmKey: string,
  ): Promise<SuccessResponseDto<DeleteAllResult>> {
    this.logger.warn('🚨 전체 대여소 삭제 API 호출됨');
    const result = await this.stationManagementService.removeAll(confirmKey);

    return SuccessResponseDto.create(
      `모든 대여소가 성공적으로 삭제되었습니다. (${result.deletedCount}개 삭제됨)`,
      result,
    );
  }

  @Delete(':number')
  @AdminProtected()
  @Throttle({ default: getAdminRateLimit() })
  @ApiOperation({
    summary: '대여소 삭제',
    description: '지정된 대여소를 영구적으로 삭제합니다.',
  })
  @ApiParam({
    name: 'number',
    description: '대여소 번호',
    example: '00648',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: '대여소 삭제 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '대여소를 찾을 수 없습니다.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async remove(
    @Param('number') number: string,
  ): Promise<SuccessResponseDto<null>> {
    await this.stationManagementService.removeByNumber(number);

    return SuccessResponseDto.create(
      '대여소가 성공적으로 삭제되었습니다.',
      null,
    );
  }

  @Get('sync/status')
  @ApiOperation({
    summary: '동기화 상태 조회',
    description: '마지막 동기화 시간과 현재 상태를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '동기화 상태 조회 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async getSyncStatus(): Promise<SuccessResponseDto<object>> {
    const status = await this.stationSyncService.getSyncStatus();
    return SuccessResponseDto.create('동기화 상태 조회 성공', status);
  }
}
