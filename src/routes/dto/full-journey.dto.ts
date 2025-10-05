import { IsNotEmpty, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CoordinateDto {
  @ApiProperty({ description: '위도' })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  lat: number;

  @ApiProperty({ description: '경도' })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  lng: number;
}

export enum BikeProfile {
  FOOT = 'foot',
  SAFE_BIKE = 'safe_bike',
  FAST_BIKE = 'fast_bike',
}

// A-B 경로 검색 요청 DTO (통합 경로, 왕복 경로에서 공통 사용)
export class PointToPointRouteRequestDto {
  @ApiProperty({ description: '출발지 좌표', type: CoordinateDto })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CoordinateDto)
  start: CoordinateDto;

  @ApiProperty({ description: '목적지 좌표', type: CoordinateDto })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CoordinateDto)
  end: CoordinateDto;
}

// 원형 경로 추천 요청 DTO (출발지 = 도착지인 원형 경로)
export class CircularRouteRequestDto {
  @ApiProperty({
    description: '출발지 좌표 (도착지와 동일)',
    type: CoordinateDto,
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CoordinateDto)
  start: CoordinateDto;

  @ApiProperty({ description: '목표 거리 (미터)', example: 5000 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  targetDistance: number;
}

// 하위 호환성을 위한 별칭들
export class RouteSearchRequestDto extends PointToPointRouteRequestDto {}
export class FullJourneyRequestDto extends PointToPointRouteRequestDto {}

export class SummaryDto {
  @ApiProperty({ description: '총 거리 (미터)' })
  distance: number;

  @ApiProperty({ description: '총 소요 시간 (초)' })
  time: number;

  @ApiProperty({ description: '총 상승 고도 (미터)' })
  ascent: number;

  @ApiProperty({ description: '총 하강 고도 (미터)' })
  descent: number;
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
  @ApiProperty({ description: '경로 포인트 배열' })
  points: number[][];
}

export class InstructionDto {
  @ApiProperty({ description: '거리 (미터)' })
  distance: number;

  @ApiProperty({ description: '소요 시간 (밀리초)' })
  time: number;

  @ApiProperty({ description: '안내 텍스트' })
  text: string;

  @ApiProperty({ description: '교차로 번호' })
  sign: number;

  @ApiProperty({ description: '시작 포인트 인덱스' })
  interval: number[];
}

export class StationDto {
  @ApiProperty({ description: '대여소 ID' })
  station_id: string;

  @ApiProperty({ description: '대여소 이름' })
  station_name: string;

  @ApiProperty({ description: '위도' })
  lat: number;

  @ApiProperty({ description: '경도' })
  lng: number;

  @ApiProperty({ description: '현재 이용 가능한 자전거 수' })
  current_bikes: number;
}

export class RouteSegmentDto {
  @ApiProperty({
    description: '구간 타입',
    enum: ['walking', 'biking'],
  })
  type: 'walking' | 'biking';

  @ApiProperty({ description: '구간 요약', type: SummaryDto })
  summary: SummaryDto;

  @ApiProperty({ description: '구간 경계 상자', type: BoundingBoxDto })
  bbox: BoundingBoxDto;

  @ApiProperty({ description: '구간 지오메트리', type: GeometryDto })
  geometry: GeometryDto;

  @ApiProperty({ description: '구간 내비게이션', type: [InstructionDto] })
  instructions: InstructionDto[];

  @ApiProperty({
    description: '자전거 프로필 (자전거 구간일 경우)',
    enum: ['safe_bike', 'fast_bike'],
    required: false,
  })
  profile?: string;

  @ApiProperty({
    description: '출발 대여소 (자전거 구간일 경우)',
    type: StationDto,
    required: false,
  })
  startStation?: StationDto;

  @ApiProperty({
    description: '도착 대여소 (자전거 구간일 경우)',
    type: StationDto,
    required: false,
  })
  endStation?: StationDto;
}

export class RouteDto {
  @ApiProperty({
    description: '경로 카테고리',
    enum: ['자전거 도로 우선 경로', '최단 거리 경로', '최소 시간 경로'],
    example: '자전거 도로 우선 경로',
  })
  routeCategory: string;

  @ApiProperty({ description: '전체 요약', type: SummaryDto })
  summary: SummaryDto;

  @ApiProperty({ description: '전체 경계 상자', type: BoundingBoxDto })
  bbox: BoundingBoxDto;

  @ApiProperty({ description: '경로 구간들', type: [RouteSegmentDto] })
  segments: RouteSegmentDto[];
}

export class FullJourneyResponseDto {
  @ApiProperty({ description: '추천 경로들', type: [RouteDto] })
  routes: RouteDto[];

  @ApiProperty({ description: '처리 시간 (밀리초)' })
  processingTime: number;
}
