import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
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
}
