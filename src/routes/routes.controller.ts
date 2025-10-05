import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
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
  @ApiOperation({ summary: '통합 경로 검색' })
  @ApiResponse({
    status: 200,
    description: '성공적으로 경로를 검색했습니다.',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '요청 데이터 오류',
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
  @ApiOperation({ summary: '왕복 경로 검색 (A → B → A)' })
  @ApiResponse({
    status: 200,
    description: '성공적으로 왕복 경로를 검색했습니다.',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '요청 데이터 오류',
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
  @ApiOperation({ summary: '왕복 경로 추천 (원형 코스)' })
  @ApiResponse({
    status: 200,
    description: '성공적으로 왕복 경로를 추천했습니다.',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '요청 데이터 오류',
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
