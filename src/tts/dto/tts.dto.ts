import { ApiProperty } from '@nestjs/swagger';

export class TtsRequestDto {
  @ApiProperty({ description: '변환할 텍스트', example: '100m 직진 후 좌회전' })
  text: string;

  @ApiProperty({
    description: '언어 코드',
    example: 'ko-KR',
    default: 'ko-KR',
  })
  lang?: string;

  @ApiProperty({
    description: '음성 이름',
    example: 'ko-KR-Standard-A',
    required: false,
  })
  voice?: string;
}

export class TtsResponseDto {
  @ApiProperty({
    description: 'TTS 상태',
    enum: ['ready', 'pending', 'error'],
    example: 'ready',
  })
  status: 'ready' | 'pending' | 'error';

  @ApiProperty({
    description: '스토리지에 저장된 오디오 파일 URL',
    example:
      'https://supabase.example/storage/v1/object/public/tts/temporary/ko-KR/abc123.mp3',
    required: false,
  })
  url?: string;

  @ApiProperty({
    description: '번역된 한글 텍스트',
    example: '공릉로27길로 좌회전하세요',
    required: false,
  })
  textKo?: string;

  @ApiProperty({
    description: 'TTS 작업 ID (해시)',
    example: 'abc123...def',
  })
  hash: string;

  @ApiProperty({
    description: '에러 메시지',
    example: 'TTS synthesis failed',
    required: false,
  })
  error?: string;

  @ApiProperty({
    description:
      '캐시 히트 여부 (true: Redis/S3 재사용, false: 새로 합성/업로드)',
    example: true,
    required: false,
  })
  cached?: boolean;
}

export interface TtsRecord {
  text: string;
  textKo: string; // 한글 번역된 텍스트
  lang: string;
  voice?: string;
  status: 'pending' | 'ready' | 'error';
  storageKey?: string;
  ttsUrl?: string;
  s3Key?: string;
  s3Url?: string;
  hash: string;
  createdAt: number;
  updatedAt?: number;
  error?: string;
}
