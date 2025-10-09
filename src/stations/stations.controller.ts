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
import { CreateStationDto, MapAreaSearchDto } from './dto/station.dto';
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

  @Get('nearby')
  @ApiOperation({
    summary: '가장 가까운 대여소 3개 검색',
    description:
      '지정된 위치 기준으로 가장 가까운 대여소 3개를 거리순으로 조회합니다.',
  })
  @ApiQuery({
    name: 'latitude',
    description: '검색할 위도 (WGS84)',
    type: Number,
    example: 37.5665,
  })
  @ApiQuery({
    name: 'longitude',
    description: '검색할 경도 (WGS84)',
    type: Number,
    example: 126.978,
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
  ): Promise<SuccessResponseDto<any[]>> {
    try {
      const lat = Number(latitude);
      const lng = Number(longitude);

      const stations = await this.stationsService.findNearbyStations(lat, lng);

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
      '지정된 중심점과 반경 내에 있는 모든 대여소를 거리순으로 조회합니다. 지도 화면에 표시할 대여소 목록을 가져올 때 사용합니다.',
  })
  @ApiQuery({
    name: 'latitude',
    description: '중심점 위도 (WGS84)',
    type: Number,
    example: 37.5665,
  })
  @ApiQuery({
    name: 'longitude',
    description: '중심점 경도 (WGS84)',
    type: Number,
    example: 126.978,
  })
  @ApiQuery({
    name: 'radius',
    description: '검색 반경 (미터)',
    type: Number,
    example: 2000,
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
  ): Promise<SuccessResponseDto<any[]>> {
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
    description: '등록된 모든 대여소 정보를 조회합니다.',
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
  async findAll(): Promise<SuccessResponseDto<any[]>> {
    try {
      const stations = await this.stationsService.findAll();

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
  async findOne(@Param('id') id: string): Promise<SuccessResponseDto<any>> {
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
  ): Promise<SuccessResponseDto<any>> {
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
  async getSyncStatus(): Promise<SuccessResponseDto<any>> {
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
