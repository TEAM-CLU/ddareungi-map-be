import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { StationsService } from './services/stations.service';
import { StationSyncService } from './services/station-sync.service';
import { StationQueryService } from './services/station-query.service';
import { StationManagementService } from './services/station-management.service';
import { StationRealtimeService } from './services/station-realtime.service';
import { StationMapperService } from './services/station-mapper.service';
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
import { Logger } from '@nestjs/common';
import {
  SuccessResponseDto,
  ErrorResponseDto,
} from '../common/api-response.dto';

@ApiTags('대여소 (stations)')
@Controller('stations')
export class StationsController {
  private readonly logger = new Logger(StationsController.name);

  constructor(
    private readonly stationsService: StationsService, // 생명주기 관리용
    private readonly stationSyncService: StationSyncService,
    private readonly stationQueryService: StationQueryService,
    private readonly stationManagementService: StationManagementService,
    private readonly stationRealtimeService: StationRealtimeService,
    private readonly stationMapperService: StationMapperService,
  ) {}

  @Post('sync')
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
    try {
      this.logger.log('수동 대여소 동기화 요청');
      await this.stationSyncService.handleWeeklySync();
      return SuccessResponseDto.create(
        '대여소 동기화가 성공적으로 완료되었습니다.',
        null,
      );
    } catch (error) {
      this.logger.error('수동 대여소 동기화 실패:', error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '대여소 동기화에 실패했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('realtime-sync')
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
    try {
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
    } catch (error) {
      this.logger.error('전체 대여소 실시간 대여정보 동기화 실패:', error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '전체 대여소 실시간 대여정보 동기화에 실패했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  @Post('realtime-sync/batch')
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
    try {
      const stationNumbers = body.stationNumbers;
      // 대여소 번호를 id로 변환
      const stationIds: string[] = [];
      for (const number of stationNumbers) {
        const station = await this.stationQueryService.findByNumber(number);
        if (station) stationIds.push(String(station.id));
      }
      const result =
        await this.stationRealtimeService.syncRealtimeInfoByIds(stationIds);
      return SuccessResponseDto.create(
        `부분 대여소 실시간 대여정보 동기화가 완료되었습니다. (성공: ${result.size}개, 실패: ${stationIds.length - result.size}개)`,
        {
          successCount: result.size,
          failureCount: stationIds.length - result.size,
        },
      );
    } catch (error) {
      this.logger.error('부분 대여소 실시간 대여정보 동기화 실패:', error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '부분 대여소 실시간 대여정보 동기화에 실패했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
  ): Promise<SuccessResponseDto<NearbyStationResponseDto[] | GeoJsonResponse>> {
    try {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (isNaN(lat) || isNaN(lng)) {
        throw new HttpException(
          ErrorResponseDto.create(
            HttpStatus.BAD_REQUEST,
            '유효하지 않은 위도/경도 값입니다.',
          ),
          HttpStatus.BAD_REQUEST,
        );
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new HttpException(
          ErrorResponseDto.create(
            HttpStatus.BAD_REQUEST,
            '위도는 -90~90, 경도는 -180~180 범위여야 합니다.',
          ),
          HttpStatus.BAD_REQUEST,
        );
      }
      const stations = await this.stationQueryService.findNearbyStations(
        lat,
        lng,
      );

      for (const station of stations) {
        if (station && station.id) {
          await this.stationRealtimeService.syncSingleStationRealtimeInfo(
            station.id,
          );
        }
      }

      if (format === 'geojson') {
        const geoJsonData =
          this.stationQueryService.convertStationsToGeoJSON(stations);
        return SuccessResponseDto.create(
          `GeoJSON 형태로 가장 가까운 대여소 ${stations.length}개를 성공적으로 조회했습니다.`,
          geoJsonData,
        );
      }

      const nearbyStations =
        this.stationMapperService.mapToNearbyResponseArray(stations);

      return SuccessResponseDto.create(
        `근처 대여소 ${stations.length}개를 성공적으로 조회했습니다.`,
        nearbyStations,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('가장 가까운 대여소 조회 실패:', error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '근처 대여소 조회에 실패했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
  ): Promise<SuccessResponseDto<NearbyStationResponseDto[] | GeoJsonResponse>> {
    try {
      // 입력값 검증
      const lat = Number(latitude);
      const lng = Number(longitude);
      const searchRadius = Number(radius);

      if (isNaN(lat) || isNaN(lng) || isNaN(searchRadius)) {
        throw new HttpException(
          ErrorResponseDto.create(
            HttpStatus.BAD_REQUEST,
            '유효하지 않은 위도/경도/반경 값입니다.',
          ),
          HttpStatus.BAD_REQUEST,
        );
      }

      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new HttpException(
          ErrorResponseDto.create(
            HttpStatus.BAD_REQUEST,
            '위도는 -90~90, 경도는 -180~180 범위여야 합니다.',
          ),
          HttpStatus.BAD_REQUEST,
        );
      }

      if (searchRadius < 100 || searchRadius > 20000) {
        throw new HttpException(
          ErrorResponseDto.create(
            HttpStatus.BAD_REQUEST,
            '반경은 100m~20km 범위여야 합니다.',
          ),
          HttpStatus.BAD_REQUEST,
        );
      }

      const stations = await this.stationQueryService.findStationsInMapArea(
        lat,
        lng,
        searchRadius,
      );

      // 조회된 대여소가 없을 때 예외처리
      if (stations.length === 0) {
        if (format === 'geojson') {
          const emptyGeoJson: GeoJsonResponse = {
            type: 'FeatureCollection',
            features: [],
          };
          return SuccessResponseDto.create(
            `지정된 영역(반경 ${searchRadius}m) 내에 이용 가능한 대여소가 없습니다.`,
            emptyGeoJson,
          );
        }

        const emptyArray: NearbyStationResponseDto[] = [];
        return SuccessResponseDto.create(
          `지정된 영역(반경 ${searchRadius}m) 내에 이용 가능한 대여소가 없습니다.`,
          emptyArray,
        );
      }

      if (format === 'geojson') {
        const geoJsonData =
          this.stationQueryService.convertStationsToGeoJSON(stations);
        return SuccessResponseDto.create(
          `GeoJSON 형태로 지도 영역 내 대여소 ${stations.length}개를 성공적으로 조회했습니다.`,
          geoJsonData,
        );
      }

      const nearbyStations =
        this.stationMapperService.mapToNearbyResponseArray(stations);

      return SuccessResponseDto.create(
        `지도 영역 내 대여소 ${stations.length}개를 성공적으로 조회했습니다.`,
        nearbyStations,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('지도 영역 내 대여소 조회 실패:', error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '지도 영역 내 대여소 조회에 실패했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
    try {
      const stations = await this.stationQueryService.findAll();

      if (format === 'geojson') {
        const geoJsonData =
          this.stationQueryService.convertStationsToGeoJSON(stations);
        return SuccessResponseDto.create(
          'GeoJSON 형태로 모든 대여소를 성공적으로 조회했습니다.',
          geoJsonData,
        );
      }

      return SuccessResponseDto.create(
        '모든 대여소를 성공적으로 조회했습니다.',
        stations,
      );
    } catch (error) {
      this.logger.error('대여소 전체 조회 실패:', error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '대여소 조회에 실패했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
    try {
      // 위치 좌표 검증 (제공된 경우)
      let validatedLat: number | undefined;
      let validatedLng: number | undefined;

      if (latitude !== undefined && longitude !== undefined) {
        const lat = Number(latitude);
        const lng = Number(longitude);

        if (
          !isNaN(lat) &&
          !isNaN(lng) &&
          lat >= -90 &&
          lat <= 90 &&
          lng >= -180 &&
          lng <= 180
        ) {
          validatedLat = lat;
          validatedLng = lng;
        }
      }

      // number로 대여소 조회 (거리 포함 가능)
      const station =
        validatedLat !== undefined && validatedLng !== undefined
          ? await this.stationQueryService.findByNumberWithDistance(
              number,
              validatedLat,
              validatedLng,
            )
          : await this.stationQueryService.findByNumber(number);

      if (!station) {
        throw new HttpException(
          ErrorResponseDto.create(
            HttpStatus.NOT_FOUND,
            '대여소를 찾을 수 없습니다.',
          ),
          HttpStatus.NOT_FOUND,
        );
      }

      // 실시간 정보 업데이트
      await this.stationRealtimeService.syncSingleStationRealtimeInfo(
        station.id,
      );

      // 업데이트된 정보 다시 조회 (거리 정보 유지)
      const updatedStation =
        validatedLat !== undefined && validatedLng !== undefined
          ? await this.stationQueryService.findByNumberWithDistance(
              number,
              validatedLat,
              validatedLng,
            )
          : await this.stationQueryService.findByNumber(number);

      if (!updatedStation) {
        throw new HttpException(
          ErrorResponseDto.create(
            HttpStatus.NOT_FOUND,
            '대여소 업데이트 후 조회에 실패했습니다.',
          ),
          HttpStatus.NOT_FOUND,
        );
      }

      if (format === 'geojson') {
        const geoJsonData = this.stationQueryService.convertStationsToGeoJSON([
          updatedStation,
        ]);
        return SuccessResponseDto.create(
          'GeoJSON 형태로 대여소 상세 정보를 성공적으로 조회했습니다.',
          geoJsonData,
        );
      }

      const nearbyStationResponse =
        this.stationMapperService.mapToNearbyResponse(updatedStation);

      return SuccessResponseDto.create(
        '대여소를 성공적으로 조회했습니다.',
        nearbyStationResponse,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`대여소 번호 ${number} 조회 실패:`, error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '대여소 조회에 실패했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post()
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
    try {
      const station =
        await this.stationManagementService.create(createStationDto);

      return {
        statusCode: HttpStatus.CREATED,
        message: '대여소가 성공적으로 생성되었습니다.',
        data: station,
      };
    } catch (error) {
      this.logger.error('대여소 생성 실패:', error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '대여소 생성에 실패했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('confirm')
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
    try {
      this.logger.warn('🚨 전체 대여소 삭제 API 호출됨');

      const result = await this.stationManagementService.removeAll(confirmKey);

      return SuccessResponseDto.create(
        `모든 대여소가 성공적으로 삭제되었습니다. (${result.deletedCount}개 삭제됨)`,
        result,
      );
    } catch (error) {
      this.logger.error('전체 대여소 삭제 실패:', error);

      if (error instanceof Error && error.message.includes('잘못된 확인 키')) {
        throw new HttpException(
          ErrorResponseDto.create(HttpStatus.BAD_REQUEST, error.message),
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          error instanceof Error
            ? error.message
            : '전체 대여소 삭제 중 내부 오류가 발생했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':number')
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
    try {
      // number로 대여소 조회해서 id 찾기
      const station = await this.stationQueryService.findByNumber(number);

      if (!station) {
        throw new HttpException(
          ErrorResponseDto.create(
            HttpStatus.NOT_FOUND,
            '대여소를 찾을 수 없습니다.',
          ),
          HttpStatus.NOT_FOUND,
        );
      }

      await this.stationManagementService.remove(station.id);

      return SuccessResponseDto.create(
        '대여소가 성공적으로 삭제되었습니다.',
        null,
      );
    } catch (error) {
      this.logger.error(`대여소 번호 ${number} 삭제 실패:`, error);

      // 404: 대여소를 찾을 수 없는 경우
      if (error instanceof Error && error.message.includes('찾을 수 없')) {
        throw new HttpException(
          ErrorResponseDto.create(HttpStatus.NOT_FOUND, error.message),
          HttpStatus.NOT_FOUND,
        );
      }

      // 500: 기타 내부 서버 오류
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          error instanceof Error
            ? error.message
            : '대여소 삭제 중 내부 오류가 발생했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
    try {
      const status = await this.stationSyncService.getSyncStatus();
      return SuccessResponseDto.create('동기화 상태 조회 성공', status);
    } catch (error) {
      this.logger.error('동기화 상태 조회 실패:', error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '동기화 상태 조회에 실패했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
