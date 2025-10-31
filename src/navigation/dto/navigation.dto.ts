import { ApiProperty } from '@nestjs/swagger';
import { GraphHopperInstruction } from '../../routes/interfaces/graphhopper.interface';
import { IsString } from 'class-validator';

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
   * 네비게이션 인스트럭션 목록
   */
  @ApiProperty({
    type: 'array',
    items: { $ref: '#/components/schemas/GraphHopperInstruction' },
    description: '네비게이션 인스트럭션 목록',
  })
  instructions: GraphHopperInstruction[];
}
