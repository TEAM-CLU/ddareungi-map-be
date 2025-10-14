import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { RoutesService } from './routes.service';
import {
  RouteDto,
  CircularRouteRequestDto,
  FullJourneyRequestDto,
} from './dto/route.dto';
import { Logger } from '@nestjs/common';
import {
  SuccessResponseDto,
  ErrorResponseDto,
} from '../common/api-response.dto';

@ApiTags('길찾기 (routes)')
@Controller('routes')
export class RoutesController {
  private readonly logger = new Logger(RoutesController.name);

  constructor(private readonly routesService: RoutesService) {}

  @Post('full-journey')
  @ApiOperation({
    summary: '통합 경로 검색 (일반 & 왕복)',
    description:
      '출발지에서 목적지까지의 최적 경로를 검색합니다. 경유지(최대 3개)를 포함할 수 있습니다. 출발지와 도착지가 같은 경우 왕복 경로로 처리되며, 이때 경유지가 반드시 필요합니다.',
  })
  @ApiBody({
    type: FullJourneyRequestDto,
    description: '경로 검색 요청 데이터',
    examples: {
      '기본 경로': {
        summary: '출발지 → 목적지 (경유지 없음)',
        value: {
          start: { lat: 37.626666, lng: 127.076764 },
          end: { lat: 37.664819, lng: 127.057126 },
        },
      },
      '경유지 포함': {
        summary: '출발지 → 경유지 → 목적지',
        value: {
          start: { lat: 37.626666, lng: 127.076764 },
          end: { lat: 37.664819, lng: 127.057126 },
          waypoints: [{ lat: 37.642417, lng: 127.067248 }],
        },
      },
      '왕복 경로': {
        summary: '출발지 → 경유지 → 출발지 (왕복)',
        value: {
          start: { lat: 37.626666, lng: 127.076764 },
          end: { lat: 37.626666, lng: 127.076764 },
          waypoints: [{ lat: 37.664819, lng: 127.057126 }],
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '성공적으로 경로를 검색했습니다.',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '요청 데이터 오류 (위도/경도 범위 초과, 필수 필드 누락)',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: 'GraphHopper 서버 응답 없음',
    type: ErrorResponseDto,
  })
  async getFullJourney(
    @Body() fullJourneyRequestDto: FullJourneyRequestDto,
  ): Promise<SuccessResponseDto<RouteDto[]>> {
    try {
      const result = await this.routesService.findFullJourney(
        fullJourneyRequestDto,
      );
      return SuccessResponseDto.create(
        '통합 경로를 성공적으로 검색했습니다.',
        result,
      );
    } catch (error) {
      this.logger.error('통합 경로 검색 중 오류 발생:', error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '통합 경로 검색 중 오류가 발생했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('circular')
  @ApiOperation({
    summary: '원형 경로 추천',
    description:
      '지정된 거리만큼의 원형 경로를 추천합니다. 출발지와 도착지가 동일한 순환 코스입니다.',
  })
  @ApiBody({
    type: CircularRouteRequestDto,
    description: '원형 경로 추천 요청 데이터',
    examples: {
      '5km 코스': {
        summary: '5km 원형 코스',
        value: {
          start: { lat: 37.626666, lng: 127.076764 },
          targetDistance: 5000,
        },
      },
      '10km 코스': {
        summary: '10km 원형 코스',
        value: {
          start: { lat: 37.626666, lng: 127.076764 },
          targetDistance: 10000,
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '성공적으로 원형 경로를 추천했습니다.',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '요청 데이터 오류 (위도/경도 범위 초과, 거리 범위 초과)',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: 'GraphHopper 서버 응답 없음',
    type: ErrorResponseDto,
  })
  async getCircularRoute(
    @Body() circularRouteRequestDto: CircularRouteRequestDto,
  ): Promise<SuccessResponseDto<RouteDto[]>> {
    try {
      const result = await this.routesService.findRoundTripRecommendations(
        circularRouteRequestDto,
      );
      return SuccessResponseDto.create(
        '원형 경로를 성공적으로 추천했습니다.',
        result,
      );
    } catch (error) {
      this.logger.error('원형 경로 추천 중 오류 발생:', error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '원형 경로 추천 중 오류가 발생했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
