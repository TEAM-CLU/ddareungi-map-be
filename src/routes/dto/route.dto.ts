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

export class CoordinateDto {
  @ApiProperty({
    description: '위도 (서울 범위: 37.0 ~ 38.0)',
    example: 37.5665,
    minimum: 37.0,
    maximum: 38.0,
  })
  @IsNotEmpty({ message: '위도는 필수값입니다.' })
  @IsNumber({}, { message: '위도는 숫자여야 합니다.' })
  @Min(33.0, { message: '위도는 37.0 이상이어야 합니다.' })
  @Max(38.9, { message: '위도는 38.0 이하여야 합니다.' })
  @Type(() => Number)
  lat: number;

  @ApiProperty({
    description: '경도 (서울 범위: 126.0 ~ 128.0)',
    example: 126.978,
    minimum: 126.0,
    maximum: 128.0,
  })
  @IsNotEmpty({ message: '경도는 필수값입니다.' })
  @IsNumber({}, { message: '경도는 숫자여야 합니다.' })
  @Min(124.5, { message: '경도는 126.0 이상이어야 합니다.' })
  @Max(131.9, { message: '경도는 128.0 이하여야 합니다.' })
  @Type(() => Number)
  lng: number;
}

export enum BikeProfile {
  SAFE_BIKE = 'safe_bike',
  FAST_BIKE = 'fast_bike',
}

export class SummaryDto {
  @ApiProperty({ description: '거리 (미터)' })
  distance: number;

  @ApiProperty({ description: '시간 (초)' })
  time: number;

  @ApiProperty({ description: '상승 고도 (미터)' })
  ascent: number;

  @ApiProperty({ description: '하강 고도 (미터)' })
  descent: number;

  @ApiProperty({
    description: '자전거 도로 비율 (0.00 ~ 1.00)',
    required: false,
    example: 0.78,
  })
  bikeRoadRatio?: number;

  @ApiProperty({
    description: '최대 경사도 (%) - 자전거 경로의 가장 가파른 구간',
    required: false,
    example: 8.5,
  })
  maxGradient?: number;
}

export class BoundingBoxDto {
  @ApiProperty({ description: '최소 위도' })
  minLat: number;

  @ApiProperty({ description: '최소 경도' })
  minLng: number;

  @ApiProperty({ description: '최대 위도' })
  maxLat: number;

  @ApiProperty({ description: '최대 경도' })
  maxLng: number;
}

export class GeometryDto {
  @ApiProperty({ description: '경로 좌표 배열' })
  points: number[][];
}

export class RouteStationDto {
  @ApiProperty({ description: '대여소 번호' })
  number: string;

  @ApiProperty({ description: '대여소 이름' })
  name: string;

  @ApiProperty({ description: '대여소 위도' })
  lat: number;

  @ApiProperty({ description: '대여소 경도' })
  lng: number;

  @ApiProperty({ description: '현재 이용 가능한 자전거 수' })
  current_bikes: number;
}

// ============================================
// 요청 DTO들
// ============================================

// A-B 경로 검색 요청 DTO (통합 경로, 왕복 경로에서 공통 사용)
export class PointToPointRouteRequestDto {
  @ApiProperty({
    description: '출발지 좌표',
    type: CoordinateDto,
    example: { lat: 37.626666, lng: 127.076764 },
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CoordinateDto)
  start: CoordinateDto;

  @ApiProperty({
    description: '목적지 좌표',
    type: CoordinateDto,
    example: { lat: 37.664819, lng: 127.057126 },
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CoordinateDto)
  end: CoordinateDto;

  @ApiProperty({
    description: '경유지 좌표 배열 (최대 3개)',
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

// 원형 경로 추천 요청 DTO (출발지 = 도착지인 원형 경로)
export class CircularRouteRequestDto {
  @ApiProperty({
    description: '출발지 좌표 (도착지와 동일)',
    type: CoordinateDto,
    example: { lat: 37.626666, lng: 127.076764 },
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CoordinateDto)
  start: CoordinateDto;

  @ApiProperty({
    description: '목표 거리 (미터, 100m ~ 50km)',
    example: 5000,
    minimum: 1000,
    maximum: 50000,
  })
  @IsNotEmpty({ message: '목표 거리는 필수값입니다.' })
  @IsNumber({}, { message: '목표 거리는 숫자여야 합니다.' })
  @Min(100, { message: '목표 거리는 최소 100m 이상이어야 합니다.' })
  @Max(50000, { message: '목표 거리는 최대 50km(50000m) 이하여야 합니다.' })
  @Type(() => Number)
  targetDistance: number;
}

// 하위 호환성을 위한 별칭들
export class RouteSearchRequestDto extends PointToPointRouteRequestDto {}
export class FullJourneyRequestDto extends PointToPointRouteRequestDto {}

// ============================================
// 응답 DTO들
// ============================================

// 경로 세그먼트 DTO (도보 또는 자전거 구간)
export class RouteSegmentDto {
  @ApiProperty({
    description: '세그먼트 타입',
    enum: ['walking', 'biking'],
  })
  type: 'walking' | 'biking';

  @ApiProperty({ description: '경로 요약', type: SummaryDto })
  summary: SummaryDto;

  @ApiProperty({ description: '경로 경계 상자', type: BoundingBoxDto })
  bbox: BoundingBoxDto;

  @ApiProperty({ description: '경로 지오메트리', type: GeometryDto })
  geometry: GeometryDto;

  @ApiProperty({
    description: '자전거 프로필 (자전거 구간에만 적용)',
    enum: BikeProfile,
    required: false,
  })
  profile?: BikeProfile;
}

// 완전한 경로 DTO (여러 세그먼트로 구성)
export class RouteDto {
  @ApiProperty({
    description: '경로 카테고리',
    example: '자전거 도로 우선',
  })
  routeCategory: string;
  @ApiProperty({
    description: '경로 고유 식별자 (Redis에 저장된 전체 경로 데이터 조회용)',
    example: 'a1b2c3d4-xxxx-yyyy',
    required: false,
  })
  routeId?: string;

  @ApiProperty({ description: '전체 경로 요약', type: SummaryDto })
  summary: SummaryDto;

  @ApiProperty({ description: '전체 경로 경계 상자', type: BoundingBoxDto })
  bbox: BoundingBoxDto;

  @ApiProperty({
    description: '시작 대여소 정보',
    type: RouteStationDto,
    required: false,
  })
  startStation?: RouteStationDto;

  @ApiProperty({
    description: '도착 대여소 정보',
    type: RouteStationDto,
    required: false,
  })
  endStation?: RouteStationDto;

  @ApiProperty({ description: '경로 세그먼트들', type: [RouteSegmentDto] })
  segments: RouteSegmentDto[];
}

// 최종 API 응답 DTO
export class RouteResponseDto {
  @ApiProperty({ description: '추천 경로들', type: [RouteDto] })
  routes: RouteDto[];

  @ApiProperty({ description: '처리 시간 (밀리초)' })
  processingTime: number;
}

// 하위 호환성을 위한 별칭
export class FullJourneyResponseDto extends RouteResponseDto {}
