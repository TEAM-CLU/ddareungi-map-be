import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Param,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import { NavigationService } from './navigation.service';
import { NavigationReturnService } from './services/navigation-return.service';
import { NavigationRerouteService } from './services/navigation-reroute.service';
import { NavigationEndService } from './services/navigation-end.service';
import {
  NavigationSessionDto,
  StartNavigationDto,
  RerouteNavigationDto,
  ReturnToRouteResponseDto,
  FullRerouteResponseDto,
} from './dto/navigation.dto';
import { SuccessResponseDto } from '../common/api-response.dto';

/**
 * 네비게이션 세션 관련 컨트롤러
 */
@ApiTags('네비게이션 (navigation)')
@Controller('navigation')
export class NavigationController {
  /**
   * @param navigationService NavigationService 인스턴스
   * @param returnService NavigationReturnService 인스턴스
   * @param rerouteService NavigationRerouteService 인스턴스
   * @param endService NavigationEndService 인스턴스
   */
  constructor(
    private readonly navigationService: NavigationService,
    private readonly returnService: NavigationReturnService,
    private readonly rerouteService: NavigationRerouteService,
    private readonly endService: NavigationEndService,
  ) {}

  /**
   * 네비게이션 세션 시작 엔드포인트
   * @param dto StartNavigationDto
   * @returns SuccessResponseDto<NavigationSessionDto>
   */
  @Post('start')
  @ApiOperation({
    summary: '네비게이션 세션 시작',
    description:
      'routeId를 받아 네비게이션 세션을 시작하고, sessionId, instruction을 반환합니다.',
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

  /**
   * 네비게이션 세션 heartbeat 엔드포인트
   * @param sessionId 세션 ID
   * @returns SuccessResponseDto<void>
   */
  @Post(':sessionId/heartbeat')
  @ApiOperation({
    summary: '네비게이션 세션 유지',
    description:
      '네비게이션 세션의 TTL을 10분으로 갱신합니다. 네비게이션 이용 중 주기적으로 호출하여 세션 만료를 방지합니다.',
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

  /**
   * 기존 경로 복귀 엔드포인트 (경미한 이탈)
   * @param sessionId 세션 ID
   * @param dto RerouteNavigationDto
   * @returns SuccessResponseDto<ReturnToRouteResponseDto>
   */
  @Post(':sessionId/return')
  @ApiOperation({
    summary: '기존 경로로 복귀 (경미한 이탈)',
    description:
      '네비게이션 중 경로에서 경미하게 이탈했을 때 사용합니다. ' +
      '현재 위치에서 다음 안내 지점까지의 짧은 복귀 경로를 생성하고, ' +
      '남은 원래 경로와 통합하여 반환합니다. ' +
      '**Redis의 원래 경로는 유지됩니다 (업데이트하지 않음).** ' +
      '프론트엔드는 원래 경로와 이탈 거리를 비교하여 Return/Reroute를 판단합니다. ' +
      'Geometry 포함하여 경로 렌더링이 가능합니다.',
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

  /**
   * 경로 재검색 엔드포인트 (이탈 시)
   * @param sessionId 세션 ID
   * @param dto RerouteNavigationDto
   * @returns SuccessResponseDto<FullRerouteResponseDto>
   */
  @Post(':sessionId/reroute')
  @ApiOperation({
    summary: '완전 재검색 (큰 이탈)',
    description:
      '네비게이션 중 경로에서 크게 이탈했을 때 사용합니다. ' +
      '현재 위치부터 목적지까지 완전히 새로운 경로를 검색하고, ' +
      '**새 경로를 Redis에 저장한 뒤 세션의 routeId를 갱신합니다.** ' +
      'Geometry 포함하여 경로 렌더링이 가능합니다. ' +
      '**주의: circular(원형) 경로는 재검색이 불가능하며, return 기능만 사용 가능합니다.** ' +
      'direct, multi-leg, roundtrip 경로 타입만 지원합니다.',
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

  /**
   * 네비게이션 세션 종료 엔드포인트
   * @param sessionId 세션 ID
   * @returns SuccessResponseDto<void>
   */
  @Delete(':sessionId')
  @ApiOperation({
    summary: '네비게이션 세션 종료',
    description:
      '네비게이션 세션을 종료하고, Redis에서 세션 데이터와 라우트 데이터를 모두 삭제합니다. ' +
      '네비게이션이 완료되거나 사용자가 중단할 때 호출합니다.',
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
}
