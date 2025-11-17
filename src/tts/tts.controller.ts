import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiProperty,
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
  async testTts(
    @Body() dto: TestTtsDto,
  ): Promise<
    SuccessResponseDto<{ text: string; textKo: string; ttsUrl?: string }>
  > {
    try {
      // synthesizeAndCache가 이미 번역을 수행함
      const result = await this.ttsService.synthesizeAndCache(dto.text);

      if (result.status === 'error') {
        throw new Error(result.error || 'TTS 생성 실패');
      }

      return SuccessResponseDto.create('TTS 생성 성공', {
        text: dto.text,
        textKo: (result.textKo as string) || dto.text,
        ttsUrl: result.url,
      });
    } catch (error) {
      throw new HttpException(
        `TTS 생성 실패: ${(error as Error).message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
