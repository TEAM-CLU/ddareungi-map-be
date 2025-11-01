import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import { NavigationService } from './navigation.service';
import { NavigationSessionDto, StartNavigationDto } from './dto/navigation.dto';
import { SuccessResponseDto } from '../common/api-response.dto';

/**
 * 네비게이션 세션 관련 컨트롤러
 */
@ApiTags('네비게이션 (navigation)')
@Controller('navigation')
export class NavigationController {
  /**
   * @param navigationService NavigationService 인스턴스
   */
  constructor(private readonly navigationService: NavigationService) {}

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
      '네비게이션 세션의 TTL을 30분으로 갱신합니다. 네비게이션 이용 중 주기적으로 호출하여 세션 만료를 방지합니다.',
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
}
