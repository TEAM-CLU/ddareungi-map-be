import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Param,
  Delete,
  Get,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import { NavigationService } from './navigation.service';
import { NavigationReturnService } from './services/navigation-return.service';
import { NavigationRerouteService } from './services/navigation-reroute.service';
import { NavigationEndService } from './services/navigation-end.service';
import { NavigationSessionService } from './services/navigation-session.service';
import {
  NavigationSessionDto,
  StartNavigationDto,
  RerouteNavigationDto,
  ReturnToRouteResponseDto,
  FullRerouteResponseDto,
} from './dto/navigation.dto';
import { SuccessResponseDto } from '../common/api-response.dto';

@ApiTags('네비게이션 (navigation)')
@Controller('navigation')
export class NavigationController {
  constructor(
    private readonly navigationService: NavigationService,
    private readonly returnService: NavigationReturnService,
    private readonly rerouteService: NavigationRerouteService,
    private readonly endService: NavigationEndService,
    private readonly sessionService: NavigationSessionService,
  ) {}

  @Post('start')
  @ApiOperation({
    summary: '네비게이션 세션 시작',
    description:
      'routeId로 네비게이션 세션을 시작합니다. ' +
      '통합된 좌표 배열, 인스트럭션, 경유지 정보를 반환하며, 세그먼트는 요약 정보만 포함합니다.',
  })
  @ApiBody({ type: StartNavigationDto })
  @ApiResponse({
    status: 200,
    description: '네비게이션 세션이 성공적으로 시작됨',
    type: SuccessResponseDto,
  })
  async startNavigation(
    @Body() dto: StartNavigationDto,
  ): Promise<SuccessResponseDto<NavigationSessionDto>> {
    try {
      const result = await this.navigationService.startNavigationSession(
        dto.routeId,
      );
      return SuccessResponseDto.create(
        '네비게이션 세션이 성공적으로 시작되었습니다.',
        result,
      );
    } catch (err) {
      throw new HttpException(
        err instanceof Error ? err.message : '알 수 없는 오류',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Post(':sessionId/heartbeat')
  @ApiOperation({
    summary: '네비게이션 세션 유지',
    description:
      '세션 TTL을 10분으로 갱신합니다. 네비게이션 중 주기적으로 호출하여 세션 만료를 방지합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '세션 TTL이 성공적으로 갱신됨',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '세션을 찾을 수 없음',
  })
  async heartbeat(
    @Param('sessionId') sessionId: string,
  ): Promise<SuccessResponseDto<void>> {
    try {
      await this.navigationService.refreshSessionTTL(sessionId);
      return SuccessResponseDto.create(
        '네비게이션 세션이 갱신되었습니다.',
        undefined,
      );
    } catch (err) {
      throw new HttpException(
        err instanceof Error ? err.message : '알 수 없는 오류',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Post(':sessionId/return')
  @ApiOperation({
    summary: '기존 경로로 복귀 (경미한 이탈)',
    description:
      '경미한 이탈 시 현재 위치에서 다음 경로 지점까지의 복귀 경로를 생성하고 남은 경로와 통합합니다. ' +
      'Redis의 원래 경로는 유지되며, 통합된 좌표/인스트럭션을 반환합니다.',
  })
  @ApiBody({ type: RerouteNavigationDto })
  @ApiResponse({
    status: 200,
    description: '기존 경로로 복귀 성공 (통합된 instructions 반환)',
    type: SuccessResponseDto<ReturnToRouteResponseDto>,
  })
  @ApiResponse({
    status: 404,
    description: '세션을 찾을 수 없음',
  })
  @ApiResponse({
    status: 400,
    description: '복귀 경로를 찾을 수 없음',
  })
  async returnToRoute(
    @Param('sessionId') sessionId: string,
    @Body() dto: RerouteNavigationDto,
  ): Promise<SuccessResponseDto<ReturnToRouteResponseDto>> {
    try {
      const result: ReturnToRouteResponseDto =
        await this.returnService.returnToRoute(sessionId, dto.currentLocation);
      return SuccessResponseDto.create(
        '기존 경로로 복귀하는 안내가 생성되었습니다.',
        result,
      );
    } catch (err) {
      const statusCode =
        err instanceof Error && err.message.includes('찾을 수 없')
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST;

      throw new HttpException(
        err instanceof Error ? err.message : '알 수 없는 오류',
        statusCode,
      );
    }
  }

  @Post(':sessionId/reroute')
  @ApiOperation({
    summary: '완전 재검색 (큰 이탈)',
    description:
      '큰 이탈 시 현재 위치부터 목적지까지 새 경로를 검색하고 Redis에 저장합니다. ' +
      '통합된 좌표/인스트럭션을 반환합니다. ' +
      'travlemode에 따라 walking은 출발 대여소부터 도착지까지 전체 경로를 검색하고 biking은 기존 출발 대여소도착 대여소까지 자전거 경로를 검색합니다.' +
      '※ circular(원형) 경로는 재검색 불가 (return만 가능)',
  })
  @ApiBody({ type: RerouteNavigationDto })
  @ApiResponse({
    status: 200,
    description: '완전 재검색 성공 (통합된 instructions 반환)',
    type: SuccessResponseDto<FullRerouteResponseDto>,
  })
  @ApiResponse({
    status: 404,
    description: '세션을 찾을 수 없음',
  })
  @ApiResponse({
    status: 400,
    description: 'circular 경로 재검색 시도 또는 경로를 찾을 수 없음',
  })
  async fullReroute(
    @Param('sessionId') sessionId: string,
    @Body() dto: RerouteNavigationDto,
  ): Promise<SuccessResponseDto<FullRerouteResponseDto>> {
    try {
      const result: FullRerouteResponseDto =
        await this.rerouteService.fullReroute(
          sessionId,
          dto.currentLocation,
          dto.remainingWaypoints,
          dto.travelMode ?? 'biking',
        );
      return SuccessResponseDto.create('새로운 경로가 검색되었습니다.', result);
    } catch (err) {
      const statusCode =
        err instanceof Error && err.message.includes('찾을 수 없')
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST;

      throw new HttpException(
        err instanceof Error ? err.message : '알 수 없는 오류',
        statusCode,
      );
    }
  }

  @Delete(':sessionId')
  @ApiOperation({
    summary: '네비게이션 세션 종료',
    description: '세션을 종료하고 Redis에서 세션 및 경로 데이터를 삭제합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '세션이 성공적으로 종료됨',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '세션을 찾을 수 없음',
  })
  async endNavigation(
    @Param('sessionId') sessionId: string,
  ): Promise<SuccessResponseDto<void>> {
    try {
      await this.endService.endNavigationSession(sessionId);
      return SuccessResponseDto.create(
        '네비게이션 세션이 종료되었습니다.',
        undefined,
      );
    } catch (err) {
      throw new HttpException(
        err instanceof Error ? err.message : '알 수 없는 오류',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  // ============================================================================
  // 테스트 엔드포인트
  // ============================================================================

  @Get('test/session/:sessionId')
  @ApiOperation({
    summary: '[테스트] 세션 데이터 조회',
    description:
      'Redis에서 세션 ID로 세션 데이터를 조회합니다. 세션에는 routeId만 포함되어 있습니다.',
  })
  @ApiResponse({
    status: 200,
    description: '세션 데이터 조회 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '세션을 찾을 수 없음',
  })
  async getSessionTest(
    @Param('sessionId') sessionId: string,
  ): Promise<SuccessResponseDto<any>> {
    try {
      const sessionData = await this.sessionService.getSession(sessionId);
      return SuccessResponseDto.create('세션 데이터 조회 성공', {
        sessionId,
        ...sessionData,
      });
    } catch (err) {
      throw new HttpException(
        err instanceof Error ? err.message : '알 수 없는 오류',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Get('test/route/:routeId')
  @ApiOperation({
    summary: '[테스트] 경로 데이터 조회',
    description:
      'Redis에서 경로 ID로 경로 데이터를 조회합니다. 세그먼트별 geometry와 instructions가 포함된 원본 데이터를 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '경로 데이터 조회 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '경로를 찾을 수 없음',
  })
  async getRouteTest(
    @Param('routeId') routeId: string,
  ): Promise<SuccessResponseDto<any>> {
    try {
      const routeData = await this.sessionService.getRoute(routeId);
      return SuccessResponseDto.create('경로 데이터 조회 성공', {
        routeId,
        ...routeData,
      });
    } catch (err) {
      throw new HttpException(
        err instanceof Error ? err.message : '알 수 없는 오류',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Get('test/session/:sessionId/with-route')
  @ApiOperation({
    summary: '[테스트] 세션 + 경로 데이터 통합 조회',
    description:
      '세션 ID로 세션과 연결된 경로 데이터를 함께 조회합니다. Redis에 저장된 원본 형태를 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '세션 및 경로 데이터 조회 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '세션 또는 경로를 찾을 수 없음',
  })
  async getSessionWithRouteTest(
    @Param('sessionId') sessionId: string,
  ): Promise<SuccessResponseDto<any>> {
    try {
      const result = await this.sessionService.getSessionWithRoute(sessionId);
      return SuccessResponseDto.create('세션 및 경로 데이터 조회 성공', result);
    } catch (err) {
      throw new HttpException(
        err instanceof Error ? err.message : '알 수 없는 오류',
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
