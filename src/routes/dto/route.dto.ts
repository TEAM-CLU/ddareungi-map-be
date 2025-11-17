import {
  IsNotEmpty,
  IsNumber,
  ValidateNested,
  IsOptional,
  IsArray,
  ArrayMaxSize,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// ============================================
// 공통 DTO
// ============================================

export class CoordinateDto {
  @ApiProperty({ description: '위도', example: 37.5665 })
  @IsNotEmpty({ message: '위도는 필수값입니다.' })
  @IsNumber({}, { message: '위도는 숫자여야 합니다.' })
  @Min(33.0, { message: '위도는 33.0 이상이어야 합니다.' })
  @Max(38.9, { message: '위도는 38.9 이하여야 합니다.' })
  @Type(() => Number)
  lat: number;

  @ApiProperty({ description: '경도', example: 126.978 })
  @IsNotEmpty({ message: '경도는 필수값입니다.' })
  @IsNumber({}, { message: '경도는 숫자여야 합니다.' })
  @Min(124.5, { message: '경도는 124.5 이상이어야 합니다.' })
  @Max(131.9, { message: '경도는 131.9 이하여야 합니다.' })
  @Type(() => Number)
  lng: number;
}

export enum BikeProfile {
  SAFE_BIKE = 'safe_bike',
  FAST_BIKE = 'fast_bike',
}

export class SummaryDto {
  @ApiProperty({ description: '거리 (미터)', example: 5420 })
  distance: number;

  @ApiProperty({ description: '소요 시간 (초)', example: 1320 })
  time: number;

  @ApiProperty({ description: '상승 고도 (미터)', example: 45 })
  ascent: number;

  @ApiProperty({ description: '하강 고도 (미터)', example: 38 })
  descent: number;

  @ApiProperty({
    description: '자전거 도로 비율 (0~1)',
    example: 0.78,
    required: false,
  })
  bikeRoadRatio?: number;

  @ApiProperty({
    description: '최대 경사도 (%)',
    example: 8.5,
    required: false,
  })
  maxGradient?: number;
}

export class BoundingBoxDto {
  @ApiProperty({ description: '최소 위도', example: 37.5 })
  minLat: number;

  @ApiProperty({ description: '최소 경도', example: 126.9 })
  minLng: number;

  @ApiProperty({ description: '최대 위도', example: 37.6 })
  maxLat: number;

  @ApiProperty({ description: '최대 경도', example: 127.0 })
  maxLng: number;
}

export class GeometryDto {
  @ApiProperty({
    description: '경로 좌표 배열 ([lng, lat] 또는 [lng, lat, elevation])',
  })
  points: number[][];
}

export class InstructionDto {
  @ApiProperty({ description: '이동 거리 (미터)', example: 150 })
  distance: number;

  @ApiProperty({ description: '이동 시간 (초)', example: 30 })
  time: number;

  @ApiProperty({ description: '안내 텍스트', example: '100m 직진 후 좌회전' })
  text: string;

  @ApiProperty({
    description: 'TTS 음성 파일 URL (S3)',
    example: 'https://bucket.s3.amazonaws.com/tts/ko-KR/abc123.mp3',
    required: false,
  })
  ttsUrl?: string;

  @ApiProperty({ description: '방향 표시 코드', example: 2 })
  sign: number;

  @ApiProperty({ description: '좌표 인덱스 범위 [시작, 끝]', type: [Number] })
  interval: [number, number];

  @ApiProperty({
    description:
      '다음 회전 지점 좌표 (사용자가 이 좌표에 가까워지면 TTS 음성 재생)',
    type: CoordinateDto,
    example: { lat: 37.5665, lng: 126.978 },
    required: false,
  })
  nextTurnCoordinate?: CoordinateDto;
}

export class RouteStationDto {
  @ApiProperty({ description: '대여소 번호', example: 'ST-123' })
  number: string;

  @ApiProperty({ description: '대여소 이름', example: '서울역 1번 출구 앞' })
  name: string;

  @ApiProperty({ description: '대여소 위도', example: 37.5665 })
  lat: number;

  @ApiProperty({ description: '대여소 경도', example: 126.978 })
  lng: number;

  @ApiProperty({ description: '현재 이용 가능한 자전거 수', example: 5 })
  current_bikes: number;
}

// ============================================
// 요청 DTO
// ============================================

export class PointToPointRouteRequestDto {
  @ApiProperty({
    description: '출발지',
    type: CoordinateDto,
    example: { lat: 37.626666, lng: 127.076764 },
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CoordinateDto)
  start: CoordinateDto;

  @ApiProperty({
    description: '목적지',
    type: CoordinateDto,
    example: { lat: 37.664819, lng: 127.057126 },
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CoordinateDto)
  end: CoordinateDto;

  @ApiProperty({
    description: '경유지 (최대 3개)',
    type: [CoordinateDto],
    required: false,
    maxItems: 3,
    example: [
      { lat: 37.642417, lng: 127.067248 },
      { lat: 37.658922, lng: 127.071167 },
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => CoordinateDto)
  waypoints?: CoordinateDto[];
}

export class CircularRouteRequestDto {
  @ApiProperty({
    description: '출발지 (도착지와 동일)',
    type: CoordinateDto,
    example: { lat: 37.626666, lng: 127.076764 },
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CoordinateDto)
  start: CoordinateDto;

  @ApiProperty({
    description: '목표 거리 (미터)',
    example: 5000,
    minimum: 100,
    maximum: 50000,
  })
  @IsNotEmpty({ message: '목표 거리는 필수값입니다.' })
  @IsNumber({}, { message: '목표 거리는 숫자여야 합니다.' })
  @Min(100, { message: '목표 거리는 최소 100m 이상이어야 합니다.' })
  @Max(50000, { message: '목표 거리는 최대 50km 이하여야 합니다.' })
  @Type(() => Number)
  targetDistance: number;
}

export class RouteSearchRequestDto extends PointToPointRouteRequestDto {}
export class FullJourneyRequestDto extends PointToPointRouteRequestDto {}

// ============================================
// 응답 DTO
// ============================================

export class RouteSegmentDto {
  @ApiProperty({
    description: '세그먼트 타입',
    example: 'biking',
    enum: ['walking', 'biking'],
  })
  type: 'walking' | 'biking';

  @ApiProperty({
    description: '자전거 프로필 (biking 타입에만 존재)',
    example: 'safe_bike',
    enum: ['safe_bike', 'fast_bike'],
    required: false,
  })
  profile?: 'safe_bike' | 'fast_bike';

  @ApiProperty({ description: '세그먼트 요약 정보', type: SummaryDto })
  summary: SummaryDto;

  @ApiProperty({ description: '세그먼트 경계 박스', type: BoundingBoxDto })
  bbox: BoundingBoxDto;

  @ApiProperty({
    description:
      '경로 좌표 (서버 내부용, 클라이언트 응답에서는 최상단으로 통합)',
    type: GeometryDto,
    required: false,
  })
  geometry?: GeometryDto;

  @ApiProperty({
    description:
      '인스트럭션 (서버 내부용, 클라이언트 응답에서는 최상단으로 통합)',
    type: [InstructionDto],
    required: false,
  })
  instructions?: InstructionDto[];
}

export class RouteDto {
  @ApiProperty({
    description: '경로 카테고리',
    example: 'bike_priority',
    enum: ['bike_priority', 'fastest', 'shortest'],
  })
  routeCategory: string;

  @ApiProperty({
    description: '경로 ID (Redis 저장용)',
    example: 'a1b2c3d4-xxxx-yyyy',
    required: false,
  })
  routeId?: string;

  @ApiProperty({ description: '전체 경로 요약', type: SummaryDto })
  summary: SummaryDto;

  @ApiProperty({ description: '전체 경로 경계 박스', type: BoundingBoxDto })
  bbox: BoundingBoxDto;

  @ApiProperty({
    description: '시작 대여소',
    type: RouteStationDto,
    required: false,
  })
  startStation?: RouteStationDto;

  @ApiProperty({
    description: '도착 대여소',
    type: RouteStationDto,
    required: false,
  })
  endStation?: RouteStationDto;

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
    required: false,
  })
  coordinates?: [number, number][];

  @ApiProperty({
    description: '통합된 인스트럭션',
    type: [InstructionDto],
    required: false,
  })
  instructions?: InstructionDto[];

  @ApiProperty({ description: '경로 세그먼트', type: [RouteSegmentDto] })
  segments: RouteSegmentDto[];
}

export class RouteResponseDto {
  @ApiProperty({ description: '추천 경로', type: [RouteDto] })
  routes: RouteDto[];

  @ApiProperty({ description: '처리 시간 (밀리초)', example: 250 })
  processingTime: number;
}

export class FullJourneyResponseDto extends RouteResponseDto {}

export const ROUTE_CATEGORY_LABELS: Record<string, string> = {
  bike_priority: '자전거 도로 우선',
  fastest: '최소 시간',
  shortest: '최단 거리',
} as const;

export function translateRouteCategory(route: RouteDto): RouteDto {
  return {
    ...route,
    routeCategory:
      ROUTE_CATEGORY_LABELS[route.routeCategory] || route.routeCategory,
  };
}

export function translateRouteCategories(routes: RouteDto[]): RouteDto[] {
  return routes.map(translateRouteCategory);
}
