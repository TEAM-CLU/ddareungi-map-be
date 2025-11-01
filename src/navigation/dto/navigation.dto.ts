import { ApiProperty } from '@nestjs/swagger';
import { InstructionDto } from '../../routes/dto/route.dto';
import { IsString } from 'class-validator';

/**
 * 세그먼트별 네비게이션 인스트럭션
 */
export class SegmentInstructionsDto {
  /**
   * 세그먼트 타입 (walking/biking)
   */
  @ApiProperty({
    example: 'walking',
    description: '세그먼트 타입 (도보 또는 자전거)',
    enum: ['walking', 'biking'],
  })
  type: 'walking' | 'biking';

  /**
   * 해당 세그먼트의 인스트럭션 배열
   */
  @ApiProperty({
    type: [InstructionDto],
    description: '해당 세그먼트의 턴바이턴 내비게이션 인스트럭션',
  })
  instructions: InstructionDto[];
}

/**
 * 네비게이션 세션 시작 요청 DTO
 */
export class StartNavigationDto {
  /**
   * 경로 식별자
   */
  @ApiProperty({ example: 'abc123', description: '경로 식별자' })
  @IsString()
  routeId: string;
}

/**
 * 네비게이션 세션 응답 DTO
 */
export class NavigationSessionDto {
  /**
   * 네비게이션 세션 ID
   */
  @ApiProperty({
    example: 'uuid-session-id',
    description: '네비게이션 세션 ID',
  })
  sessionId: string;

  /**
   * 세그먼트별 네비게이션 인스트럭션 목록
   */
  @ApiProperty({
    type: [SegmentInstructionsDto],
    description: '세그먼트별로 구분된 네비게이션 인스트럭션',
  })
  segments: SegmentInstructionsDto[];
}
