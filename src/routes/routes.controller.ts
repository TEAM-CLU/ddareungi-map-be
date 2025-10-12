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
  RoundTripSearchRequestDto,
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
    summary: '통합 경로 검색',
    description:
      '출발지에서 목적지까지의 최적 경로를 검색합니다. 경유지(최대 3개)를 포함할 수 있습니다.',
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
          '경로 검색 중 오류가 발생했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('round-trip/search')
  @ApiOperation({
    summary: '왕복 경로 검색 (A → B → A)',
    description:
      '출발지에서 반환점까지 갔다가 다시 출발지로 돌아오는 왕복 경로를 검색합니다. waypoints 배열에 경유지(waypoint)와 반환점(return_point)을 순서대로 포함할 수 있습니다. 반환점은 정확히 1개만 허용됩니다.',
  })
  @ApiBody({
    type: RoundTripSearchRequestDto,
    description: '왕복 경로 검색 요청 데이터',
    examples: {
      '기본 왕복': {
        summary: '출발지 → 반환점 → 출발지',
        value: {
          start: { lat: 37.626666, lng: 127.076764 },
          waypoints: [
            {
              type: 'return_point',
              location: { lat: 37.664819, lng: 127.057126 },
            },
          ],
        },
      },
      '반환점 이전 경유지': {
        summary: '출발지 → 경유지 → 반환점 → 출발지',
        value: {
          start: { lat: 37.626666, lng: 127.076764 },
          waypoints: [
            {
              type: 'waypoint',
              location: { lat: 37.642417, lng: 127.067248 },
            },
            {
              type: 'return_point',
              location: { lat: 37.664819, lng: 127.057126 },
            },
          ],
        },
      },
      '반환점 이후 경유지': {
        summary: '출발지 → 반환점 → 경유지 → 출발지',
        value: {
          start: { lat: 37.626666, lng: 127.076764 },
          waypoints: [
            {
              type: 'return_point',
              location: { lat: 37.664819, lng: 127.057126 },
            },
            {
              type: 'waypoint',
              location: { lat: 37.658922, lng: 127.071167 },
            },
          ],
        },
      },
      '반환점 전후 경유지': {
        summary: '출발지 → 경유지1 → 반환점 → 경유지2 → 출발지',
        value: {
          start: { lat: 37.626666, lng: 127.076764 },
          waypoints: [
            {
              type: 'waypoint',
              location: { lat: 37.642417, lng: 127.067248 },
            },
            {
              type: 'return_point',
              location: { lat: 37.664819, lng: 127.057126 },
            },
            {
              type: 'waypoint',
              location: { lat: 37.658922, lng: 127.071167 },
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '성공적으로 왕복 경로를 검색했습니다.',
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
  async getRoundTripSearch(
    @Body() roundTripSearchRequestDto: RoundTripSearchRequestDto,
  ): Promise<SuccessResponseDto<RouteDto[]>> {
    try {
      const result = await this.routesService.findRoundTripSearch(
        roundTripSearchRequestDto,
      );
      return SuccessResponseDto.create(
        '왕복 경로를 성공적으로 검색했습니다.',
        result,
      );
    } catch (error) {
      this.logger.error('왕복 경로 검색 중 오류 발생:', error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '왕복 경로 검색 중 오류가 발생했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('round-trip/recommend')
  @ApiOperation({
    summary: '왕복 경로 추천 (원형 코스)',
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
    description: '성공적으로 왕복 경로를 추천했습니다.',
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
  async getRoundTripRecommend(
    @Body() circularRouteRequestDto: CircularRouteRequestDto,
  ): Promise<SuccessResponseDto<RouteDto[]>> {
    try {
      const result = await this.routesService.findRoundTripRecommendations(
        circularRouteRequestDto,
      );
      return SuccessResponseDto.create(
        '왕복 경로를 성공적으로 추천했습니다.',
        result,
      );
    } catch (error) {
      this.logger.error('왕복 경로 추천 중 오류 발생:', error);
      throw new HttpException(
        ErrorResponseDto.create(
          HttpStatus.INTERNAL_SERVER_ERROR,
          '왕복 경로 추천 중 오류가 발생했습니다.',
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
