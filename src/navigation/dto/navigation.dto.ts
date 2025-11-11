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

// ============================================
// 요청 DTO
// ============================================

export class StartNavigationDto {
  @ApiProperty({
    description: '경로 식별자 (Redis에 저장된 경로 ID)',
    example: 'abc123',
  })
  @IsString()
  routeId: string;
}

export class RerouteNavigationDto {
  @ApiProperty({
    description: '사용자의 현재 위치',
    type: CoordinateDto,
    example: { lat: 37.5665, lng: 126.978 },
  })
  @IsNotEmpty({ message: '현재 위치는 필수값입니다.' })
  @ValidateNested()
  @Type(() => CoordinateDto)
  currentLocation: CoordinateDto;

  @ApiProperty({
    description: '남은 경유지 배열 (선택적, 프론트엔드에서 계산)',
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

// ============================================
// 공통 응답 필드 DTO
// ============================================

export class StationInfoDto {
  @ApiProperty({ description: '대여소 ID', example: 'ST-123' })
  stationId: string;

  @ApiProperty({ description: '대여소 이름', example: '서울역 1번 출구 앞' })
  stationName: string;

  @ApiProperty({ description: '대여소 위치', type: CoordinateDto })
  location: CoordinateDto;
}

export class RouteSummaryDto {
  @ApiProperty({ description: '총 거리 (미터)', example: 5420 })
  distance: number;

  @ApiProperty({ description: '총 소요 시간 (초)', example: 1320 })
  time: number;

  @ApiProperty({ description: '총 상승 고도 (미터)', example: 45 })
  ascent: number;

  @ApiProperty({ description: '총 하강 고도 (미터)', example: 38 })
  descent: number;
}

// ============================================
// 응답 DTO
// ============================================

export class NavigationSessionDto {
  @ApiProperty({
    description: '네비게이션 세션 ID',
    example: 'uuid-session-id',
  })
  sessionId: string;

  @ApiProperty({
    description: '경유지 ({lat, lng} 형식)',
    type: [CoordinateDto],
    example: [
      { lat: 37.642417, lng: 127.067248 },
      { lat: 37.658922, lng: 127.071167 },
    ],
    required: false,
  })
  waypoints?: CoordinateDto[];

  @ApiProperty({
    description: '통합된 경로 좌표 ([lng, lat] 형식)',
    example: [
      [127.076764, 37.626666],
      [127.0768, 37.6267],
    ],
  })
  coordinates: [number, number][];

  @ApiProperty({
    description: '통합된 인스트럭션',
    type: [InstructionDto],
  })
  instructions: InstructionDto[];

  @ApiProperty({
    description: '경로 세그먼트 (geometry, instructions 제외)',
    type: [RouteSegmentDto],
  })
  segments: RouteSegmentDto[];
}

export class ReturnToRouteResponseDto {
  @ApiProperty({
    description: '경로 카테고리',
    example: 'bike_priority',
    enum: ['bike_priority', 'fastest', 'shortest'],
  })
  routeCategory: string;

  @ApiProperty({ description: '경로 요약 정보', type: RouteSummaryDto })
  summary: RouteSummaryDto;

  @ApiProperty({
    description: '경로 경계 박스',
    example: { minLat: 37.5, maxLat: 37.6, minLng: 126.9, maxLng: 127.0 },
  })
  bbox: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };

  @ApiProperty({
    description: '시작 대여소 정보',
    type: StationInfoDto,
    required: false,
  })
  startStation?: StationInfoDto;

  @ApiProperty({
    description: '종료 대여소 정보',
    type: StationInfoDto,
    required: false,
  })
  endStation?: StationInfoDto;

  @ApiProperty({
    description: '경유지 ({lat, lng} 형식)',
    type: [CoordinateDto],
    example: [
      { lat: 37.642417, lng: 127.067248 },
      { lat: 37.658922, lng: 127.071167 },
    ],
    required: false,
  })
  waypoints?: CoordinateDto[];

  @ApiProperty({
    description: '통합된 경로 좌표 ([lng, lat] 형식)',
    example: [
      [127.076764, 37.626666],
      [127.0768, 37.6267],
    ],
  })
  coordinates: [number, number][];

  @ApiProperty({
    description: '통합된 인스트럭션',
    type: [InstructionDto],
  })
  instructions: InstructionDto[];

  @ApiProperty({
    description: '경로 세그먼트 (geometry, instructions 제외)',
    type: [RouteSegmentDto],
  })
  segments: RouteSegmentDto[];
}

export class FullRerouteResponseDto {
  @ApiProperty({
    description: '경로 카테고리',
    example: 'bike_priority',
    enum: ['bike_priority', 'fastest', 'shortest'],
  })
  routeCategory: string;

  @ApiProperty({ description: '경로 요약 정보', type: RouteSummaryDto })
  summary: RouteSummaryDto;

  @ApiProperty({
    description: '경로 경계 박스',
    example: { minLat: 37.5, maxLat: 37.6, minLng: 126.9, maxLng: 127.0 },
  })
  bbox: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };

  @ApiProperty({
    description: '시작 대여소 정보',
    type: StationInfoDto,
    required: false,
  })
  startStation?: StationInfoDto;

  @ApiProperty({
    description: '종료 대여소 정보',
    type: StationInfoDto,
    required: false,
  })
  endStation?: StationInfoDto;

  @ApiProperty({
    description: '경유지 ({lat, lng} 형식)',
    type: [CoordinateDto],
    example: [
      { lat: 37.642417, lng: 127.067248 },
      { lat: 37.658922, lng: 127.071167 },
    ],
    required: false,
  })
  waypoints?: CoordinateDto[];

  @ApiProperty({
    description: '통합된 경로 좌표 ([lng, lat] 형식)',
    example: [
      [127.076764, 37.626666],
      [127.0768, 37.6267],
    ],
  })
  coordinates: [number, number][];

  @ApiProperty({
    description: '통합된 인스트럭션',
    type: [InstructionDto],
  })
  instructions: InstructionDto[];

  @ApiProperty({
    description: '경로 세그먼트 (geometry, instructions 제외)',
    type: [RouteSegmentDto],
  })
  segments: RouteSegmentDto[];
}
