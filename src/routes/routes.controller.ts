import { Controller, Post, Body, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { RoutesService } from './routes.service';
import {
  RouteDto,
  CircularRouteRequestDto,
  FullJourneyRequestDto,
} from './dto/route.dto';
import {
  SuccessResponseDto,
  ErrorResponseDto,
} from '../common/api-response.dto';
import {
  ANALYTICS_EVENT_API_OPERATION_RESULT,
  ANALYTICS_EVENT_ROUTE_SEARCH_COMPLETED,
  getErrorType,
  getHttpStatusFromError,
} from '../analytics/analytics.constants';
import { AnalyticsIdentityResolver } from '../analytics/analytics-identity.resolver';
import { AnalyticsService } from '../analytics/analytics.service';
import type { AnalyticsRequest } from '../analytics/analytics.types';

@ApiTags('길찾기 (routes)')
@Controller('routes')
export class RoutesController {
  constructor(
    private readonly routesService: RoutesService,
    private readonly analyticsService: AnalyticsService,
    private readonly analyticsIdentityResolver: AnalyticsIdentityResolver,
  ) {}

  private resolveJourneyShape(request: FullJourneyRequestDto): string {
    const isRoundTrip =
      request.start.lat === request.end.lat &&
      request.start.lng === request.end.lng;

    if (isRoundTrip) {
      return 'round_trip';
    }

    if ((request.waypoints?.length ?? 0) > 0) {
      return 'multi_leg';
    }

    return 'direct';
  }

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
    @Req() request: AnalyticsRequest,
  ): Promise<SuccessResponseDto<RouteDto[]>> {
    const startedAt = Date.now();
    const identity = this.analyticsIdentityResolver.resolve(request);
    const journeyShape = this.resolveJourneyShape(fullJourneyRequestDto);

    try {
      const result = await this.routesService.findFullJourney(
        fullJourneyRequestDto,
      );

      this.analyticsService.trackEvent({
        name: ANALYTICS_EVENT_ROUTE_SEARCH_COMPLETED,
        identity,
        params: {
          route_search_type: 'full_journey',
          journey_shape: journeyShape,
          waypoint_count: fullJourneyRequestDto.waypoints?.length ?? 0,
          result_count: result.length,
          auth_state: identity.authState,
        },
      });
      this.analyticsService.trackEvent({
        name: ANALYTICS_EVENT_API_OPERATION_RESULT,
        identity,
        params: {
          feature_area: 'route_search',
          operation_name: 'get_full_journey',
          outcome: 'success',
          duration_ms: Date.now() - startedAt,
          http_status: 200,
          auth_state: identity.authState,
        },
      });

      return SuccessResponseDto.create(
        '통합 경로를 성공적으로 검색했습니다.',
        result,
      );
    } catch (error) {
      this.analyticsService.trackEvent({
        name: ANALYTICS_EVENT_API_OPERATION_RESULT,
        identity,
        params: {
          feature_area: 'route_search',
          operation_name: 'get_full_journey',
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

  @Post('circular-journey')
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
    @Req() request: AnalyticsRequest,
  ): Promise<SuccessResponseDto<RouteDto[]>> {
    const startedAt = Date.now();
    const identity = this.analyticsIdentityResolver.resolve(request);

    try {
      const result = await this.routesService.findRoundTripRecommendations(
        circularRouteRequestDto,
      );

      this.analyticsService.trackEvent({
        name: ANALYTICS_EVENT_ROUTE_SEARCH_COMPLETED,
        identity,
        params: {
          route_search_type: 'circular_journey',
          journey_shape: 'circular',
          waypoint_count: 0,
          result_count: result.length,
          auth_state: identity.authState,
        },
      });
      this.analyticsService.trackEvent({
        name: ANALYTICS_EVENT_API_OPERATION_RESULT,
        identity,
        params: {
          feature_area: 'route_search',
          operation_name: 'get_circular_route',
          outcome: 'success',
          duration_ms: Date.now() - startedAt,
          http_status: 200,
          auth_state: identity.authState,
        },
      });

      return SuccessResponseDto.create(
        '원형 경로를 성공적으로 추천했습니다.',
        result,
      );
    } catch (error) {
      this.analyticsService.trackEvent({
        name: ANALYTICS_EVENT_API_OPERATION_RESULT,
        identity,
        params: {
          feature_area: 'route_search',
          operation_name: 'get_circular_route',
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
}
