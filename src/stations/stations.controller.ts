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
} from '@nestjs/swagger';
import { StationsService } from './services/stations.service';
import { CreateStationDto, StationResponseDto } from './dto/station.dto';
import {
  DeleteAllResult,
  GeoJSONFeatureCollection,
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

  constructor(private readonly stationsService: StationsService) {}

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
      this.logger.log('수동 대여소 동기화 요청 받음');
      await this.stationsService.handleWeeklySync();

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
    summary: '실시간 대여정보 동기화',
    description:
      '서울시 공공자전거 실시간 대여정보 API를 호출하여 특정 대여소의 현재 자전거 수와 거치대 수를 업데이트합니다.',
  })
  @ApiQuery({
    name: 'stationId',
    description: '동기화할 대여소의 외부 스테이션 ID',
    type: String,
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: '실시간 동기화 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '대여소를 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async syncRealtimeStationInfo(
    @Query('stationId') stationId?: string,
  ): Promise<SuccessResponseDto<object>> {
    try {
      this.logger.log(
        `실시간 대여정보 동기화 요청: ${stationId || '전체 대여소'}`,
      );

      if (stationId) {
        // 특정 대여소만 동기화
        const realtimeInfo =
          await this.stationsService.syncSingleStationRealtimeInfo(stationId);

        if (!realtimeInfo) {
          throw new HttpException(
            ErrorResponseDto.create(
              HttpStatus.NOT_FOUND,
              `대여소 ID ${stationId}를 찾을 수 없습니다.`,
            ),
            HttpStatus.NOT_FOUND,
          );
        }

        return SuccessResponseDto.create(
          '실시간 대여정보 동기화가 성공적으로 완료되었습니다.',
          realtimeInfo,
        );
      } else {
        // 전체 대여소 동기화 (개발/테스트 용도)
        const result = await this.stationsService.syncAllStationsRealtimeInfo();

        return SuccessResponseDto.create(
          `실시간 대여정보 동기화가 완료되었습니다. (성공: ${result.successCount}개, 실패: ${result.failureCount}개)`,
          result,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('실시간 대여정보 동기화 실패:', error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '실시간 대여정보 동기화에 실패했습니다.',
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
    description: '근처 대여소 조회 성공',
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
  async findNearbyStations(
    @Query('latitude') latitude: number,
    @Query('longitude') longitude: number,
    @Query('format') format: 'json' | 'geojson' = 'json',
  ): Promise<
    SuccessResponseDto<StationResponseDto[] | GeoJSONFeatureCollection>
  > {
    try {
      const lat = Number(latitude);
      const lng = Number(longitude);

      const stations = await this.stationsService.findNearbyStations(lat, lng);

      if (format === 'geojson') {
        const geoJsonData =
          this.stationsService.convertStationsToGeoJSON(stations);
        return SuccessResponseDto.create(
          'GeoJSON 형태로 가장 가까운 대여소 3개를 성공적으로 조회했습니다.',
          geoJsonData,
        );
      }

      return SuccessResponseDto.create(
        '가장 가까운 대여소 3개를 성공적으로 조회했습니다.',
        stations,
      );
    } catch (error) {
      this.logger.error('근처 대여소 조회 실패:', error);
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
  async findStationsInMapArea(
    @Query('latitude') latitude: number,
    @Query('longitude') longitude: number,
    @Query('radius') radius: number,
    @Query('format') format: 'json' | 'geojson' = 'json',
  ): Promise<
    SuccessResponseDto<StationResponseDto[] | GeoJSONFeatureCollection>
  > {
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

      const stations = await this.stationsService.findStationsInMapArea(
        lat,
        lng,
        searchRadius,
      );

      if (format === 'geojson') {
        const geoJsonData =
          this.stationsService.convertStationsToGeoJSON(stations);
        return SuccessResponseDto.create(
          `GeoJSON 형태로 지도 영역 내 대여소 ${stations.length}개를 성공적으로 조회했습니다.`,
          geoJsonData,
        );
      }

      return SuccessResponseDto.create(
        `지도 영역 내 대여소 ${stations.length}개를 성공적으로 조회했습니다.`,
        stations,
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
  ): Promise<
    SuccessResponseDto<StationResponseDto[] | GeoJSONFeatureCollection>
  > {
    try {
      const stations = await this.stationsService.findAll();

      if (format === 'geojson') {
        const geoJsonData =
          this.stationsService.convertStationsToGeoJSON(stations);
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

  @Get(':id')
  @ApiOperation({
    summary: '대여소 상세 조회',
    description: '대여소 ID로 특정 대여소의 상세 정보를 조회합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '대여소 ID',
    example: 'ST-1001',
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
    @Param('id') id: string,
  ): Promise<SuccessResponseDto<StationResponseDto>> {
    try {
      const station = await this.stationsService.findOne(id);

      if (!station) {
        throw new HttpException(
          ErrorResponseDto.create(
            HttpStatus.NOT_FOUND,
            '대여소를 찾을 수 없습니다.',
          ),
          HttpStatus.NOT_FOUND,
        );
      }

      return SuccessResponseDto.create(
        '대여소를 성공적으로 조회했습니다.',
        station,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`대여소 ID ${id} 조회 실패:`, error);
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
      const station = await this.stationsService.create(createStationDto);

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

  @Delete(':id')
  @ApiOperation({
    summary: '대여소 삭제',
    description: '지정된 대여소를 영구적으로 삭제합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '대여소 ID',
    example: 'ST-1001',
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
  async remove(@Param('id') id: string): Promise<SuccessResponseDto<null>> {
    try {
      await this.stationsService.remove(id);

      return SuccessResponseDto.create(
        '대여소가 성공적으로 삭제되었습니다.',
        null,
      );
    } catch (error) {
      this.logger.error(`대여소 ID ${id} 삭제 실패:`, error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.NOT_FOUND,
          error instanceof Error
            ? error.message
            : '대여소 삭제에 실패했습니다.',
        ),
        HttpStatus.NOT_FOUND,
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

      const result = await this.stationsService.removeAll(confirmKey);

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
            : '전체 대여소 삭제에 실패했습니다.',
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
      const status = await this.stationsService.getSyncStatus();
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
