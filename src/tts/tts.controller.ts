import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Get,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiProperty,
  ApiQuery,
} from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { TtsService } from './tts.service';
import { SuccessResponseDto } from '../common/api-response.dto';

class TestTtsDto {
  @ApiProperty({
    description: '번역할 영어 텍스트 (예: "Turn left onto 공릉로27길")',
    example: 'Turn left onto 공릉로27길',
  })
  @IsString()
  @IsNotEmpty()
  text: string;
}

class PermanentTtsDto {
  @ApiProperty({
    description: '고정 메시지 텍스트 (한글)',
    example: '음성 안내를 시작합니다',
  })
  @IsString()
  @IsNotEmpty()
  text: string;
}

@ApiTags('TTS 테스트')
@Controller('tts')
export class TtsController {
  constructor(private readonly ttsService: TtsService) {}

  @Post('test')
  @ApiOperation({
    summary: 'TTS 테스트',
    description: '텍스트를 한글로 번역하고 TTS 음성 파일 URL을 생성합니다.',
  })
  @ApiBody({ type: TestTtsDto })
  @ApiResponse({
    status: 200,
    description: 'TTS 생성 성공',
    type: SuccessResponseDto,
  })
  async testTts(@Body() dto: TestTtsDto): Promise<
    SuccessResponseDto<{
      text: string;
      textKo: string;
      cached: boolean;
      ttsUrl?: string;
    }>
  > {
    try {
      // synthesizeAndCache가 이미 번역을 수행함
      const result = await this.ttsService.synthesizeAndCache(dto.text);

      if (result.status === 'error') {
        throw new Error(result.error || 'TTS 생성 실패');
      }

      const message = result.cached
        ? '캐시된 TTS를 반환했습니다.'
        : 'TTS를 새로 생성했습니다.';

      return SuccessResponseDto.create(message, {
        text: dto.text,
        textKo: (result.textKo as string) || dto.text,
        cached: Boolean(result.cached),
        ttsUrl: result.url,
      });
    } catch (error) {
      throw new HttpException(
        `TTS 생성 실패: ${(error as Error).message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('permanent')
  @ApiOperation({
    summary: '고정 메시지 TTS 생성 (만료 없음)',
    description:
      '고정 메시지용 TTS를 생성합니다. Redis에 10년 TTL로 저장되어 사실상 영구 보관됩니다.',
  })
  @ApiBody({ type: PermanentTtsDto })
  @ApiResponse({
    status: 200,
    description: '고정 메시지 TTS 생성 성공',
    type: SuccessResponseDto,
  })
  async createPermanentTts(
    @Body() dto: PermanentTtsDto,
  ): Promise<
    SuccessResponseDto<{ text: string; cached: boolean; ttsUrl?: string }>
  > {
    try {
      const result = await this.ttsService.synthesizePermanent(dto.text);

      if (result.status === 'error') {
        throw new Error(result.error || 'TTS 생성 실패');
      }

      const message = result.cached
        ? '캐시된 고정 메시지 TTS를 반환했습니다.'
        : '고정 메시지 TTS를 새로 생성했습니다.';

      return SuccessResponseDto.create(message, {
        text: dto.text,
        cached: Boolean(result.cached),
        ttsUrl: result.url,
      });
    } catch (error) {
      throw new HttpException(
        `고정 메시지 TTS 생성 실패: ${(error as Error).message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('lookup')
  @ApiOperation({
    summary: 'TTS 캐시 조회',
    description:
      'text가 있으면 특정 TTS를 조회하고, text가 없으면 임시(TTL) TTS 캐시 목록을 조회합니다.',
  })
  @ApiQuery({
    name: 'text',
    description: '조회할 텍스트',
    example: 'Turn left onto 공릉로27길',
    required: false,
  })
  @ApiQuery({
    name: 'cursor',
    description: 'Redis SCAN cursor (페이징용). 최초 호출은 생략 또는 "0".',
    required: false,
    example: '0',
  })
  @ApiQuery({
    name: 'limit',
    description: '목록 조회 시 최대 개수 (기본 200, 최대 1000)',
    required: false,
    example: 200,
  })
  @ApiResponse({
    status: 200,
    description: 'TTS 조회 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '캐시에 TTS가 없음',
  })
  async lookupTts(
    @Query('text') text?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<
    SuccessResponseDto<
      | { text: string; cached: boolean; ttsUrl?: string }
      | { items: unknown[]; nextCursor: string }
    >
  > {
    try {
      // 전체 조회 (임시 캐시 목록)
      if (!text || !text.trim()) {
        const { items, nextCursor } = await this.ttsService.listCached(
          'temporary',
          cursor || '0',
          limit ? Number(limit) : 200,
        );
        return SuccessResponseDto.create('임시 TTS 캐시 목록 조회 성공', {
          items,
          nextCursor,
        });
      }

      const result = await this.ttsService.lookup(text);

      if (!result) {
        return SuccessResponseDto.create('캐시에 TTS가 없습니다', {
          text,
          cached: false,
        });
      }

      return SuccessResponseDto.create('TTS 캐시 조회 성공', {
        text,
        cached: true,
        ttsUrl: result.url,
      });
    } catch (error) {
      throw new HttpException(
        `TTS 조회 실패: ${(error as Error).message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('lookup-permanent')
  @ApiOperation({
    summary: '고정 메시지 TTS 캐시 조회',
    description:
      'text가 있으면 특정 고정 메시지 TTS를 조회하고, text가 없으면 고정 메시지 캐시 목록을 조회합니다.',
  })
  @ApiQuery({
    name: 'text',
    description: '조회할 고정 메시지',
    example: '음성 안내를 시작합니다',
    required: false,
  })
  @ApiQuery({
    name: 'cursor',
    description: 'Redis SCAN cursor (페이징용). 최초 호출은 생략 또는 "0".',
    required: false,
    example: '0',
  })
  @ApiQuery({
    name: 'limit',
    description: '목록 조회 시 최대 개수 (기본 200, 최대 1000)',
    required: false,
    example: 200,
  })
  @ApiResponse({
    status: 200,
    description: 'TTS 조회 성공',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '캐시에 TTS가 없음',
  })
  async lookupPermanentTts(
    @Query('text') text?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<
    SuccessResponseDto<
      | { text: string; cached: boolean; ttsUrl?: string }
      | { items: unknown[]; nextCursor: string }
    >
  > {
    try {
      // 전체 조회 (고정 메시지 캐시 목록)
      if (!text || !text.trim()) {
        const { items, nextCursor } = await this.ttsService.listCached(
          'permanent',
          cursor || '0',
          limit ? Number(limit) : 200,
        );
        return SuccessResponseDto.create(
          '고정 메시지 TTS 캐시 목록 조회 성공',
          {
            items,
            nextCursor,
          },
        );
      }

      const result = await this.ttsService.lookupPermanent(text);

      if (!result) {
        return SuccessResponseDto.create('캐시에 고정 메시지 TTS가 없습니다', {
          text,
          cached: false,
        });
      }

      return SuccessResponseDto.create('고정 메시지 TTS 캐시 조회 성공', {
        text,
        cached: true,
        ttsUrl: result.url,
      });
    } catch (error) {
      throw new HttpException(
        `고정 메시지 TTS 조회 실패: ${(error as Error).message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
