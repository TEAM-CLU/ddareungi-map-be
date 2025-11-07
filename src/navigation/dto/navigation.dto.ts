import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  ValidateNested,
  IsNotEmpty,
  IsArray,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  InstructionDto,
  CoordinateDto,
  RouteSegmentDto,
} from '../../routes/dto/route.dto';

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
   * 통합된 네비게이션 인스트럭션 목록
   */
  @ApiProperty({
    type: [InstructionDto],
    description: '모든 세그먼트의 인스트럭션이 통합된 배열',
  })
  instructions: InstructionDto[];
}

/**
 * 경로 재검색 요청 DTO
 */
export class RerouteNavigationDto {
  /**
   * 현재 위치
   */
  @ApiProperty({
    description: '현재 위치 좌표',
    type: CoordinateDto,
    example: { lat: 37.5665, lng: 126.978 },
  })
  @IsNotEmpty({ message: '현재 위치는 필수값입니다.' })
  @ValidateNested()
  @Type(() => CoordinateDto)
  currentLocation: CoordinateDto;

  /**
   * 남은 경유지 배열 (프론트엔드에서 계산)
   */
  @ApiProperty({
    description:
      '아직 방문하지 않은 남은 경유지 배열 (순서대로, 프론트엔드가 현재 위치 기반으로 계산)',
    type: [CoordinateDto],
    example: [
      { lat: 37.5662, lng: 127.0012 },
      { lat: 37.5172, lng: 127.0473 },
    ],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CoordinateDto)
  remainingWaypoints?: CoordinateDto[];
}

/**
 * 기존 경로 복귀 응답 DTO (geometry 포함)
 */
export class ReturnToRouteResponseDto {
  /**
   * 네비게이션 세션 ID
   */
  @ApiProperty({
    example: 'uuid-session-id',
    description: '네비게이션 세션 ID',
  })
  sessionId: string;

  /**
   * 통합된 경로 세그먼트 (복귀 경로 + 남은 원래 경로)
   */
  @ApiProperty({
    type: [RouteSegmentDto],
    description: '복귀 경로와 남은 경로가 통합된 세그먼트 배열 (geometry 포함)',
  })
  segments: RouteSegmentDto[];

  /**
   * 통합된 네비게이션 인스트럭션 (복귀 경로 + 남은 경로)
   */
  @ApiProperty({
    type: [InstructionDto],
    description: '복귀 경로와 남은 경로가 통합된 인스트럭션 배열',
  })
  instructions: InstructionDto[];
}

/**
 * 완전 재검색 응답 DTO (geometry 포함)
 */
export class FullRerouteResponseDto {
  /**
   * 네비게이션 세션 ID
   */
  @ApiProperty({
    example: 'uuid-session-id',
    description: '네비게이션 세션 ID',
  })
  sessionId: string;

  /**
   * 재검색된 경로 세그먼트 (geometry 포함)
   */
  @ApiProperty({
    type: [RouteSegmentDto],
    description: '재검색된 경로의 모든 세그먼트 (geometry 포함)',
  })
  segments: RouteSegmentDto[];

  /**
   * 통합된 네비게이션 인스트럭션
   */
  @ApiProperty({
    type: [InstructionDto],
    description: '재검색된 경로의 모든 인스트럭션이 통합된 배열',
  })
  instructions: InstructionDto[];
}
