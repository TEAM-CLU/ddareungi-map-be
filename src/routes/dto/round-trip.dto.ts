import { ApiProperty } from '@nestjs/swagger';
import {
  SummaryDto,
  BoundingBoxDto,
  GeometryDto,
  InstructionDto,
  PointToPointRouteRequestDto,
  CircularRouteRequestDto,
} from './full-journey.dto';

// 하위 호환성을 위해 공통 DTO를 상속
export class RoundTripSearchRequestDto extends PointToPointRouteRequestDto {}

// 하위 호환성을 위한 별칭
export class RoundTripRecommendRequestDto extends CircularRouteRequestDto {}

export class RoundTripRouteDto {
  @ApiProperty({
    description: '경로 타입',
    enum: [
      'outbound',
      'return',
      'loop',
      'walking_to_station',
      'bike_round_trip',
      'walking',
      'biking',
    ],
  })
  type:
    | 'outbound'
    | 'return'
    | 'loop'
    | 'walking_to_station'
    | 'bike_round_trip'
    | 'walking'
    | 'biking';

  @ApiProperty({ description: '경로 요약', type: SummaryDto })
  summary: SummaryDto;

  @ApiProperty({ description: '경로 경계 상자', type: BoundingBoxDto })
  bbox: BoundingBoxDto;

  @ApiProperty({ description: '경로 지오메트리', type: GeometryDto })
  geometry: GeometryDto;

  @ApiProperty({ description: '내비게이션', type: [InstructionDto] })
  instructions: InstructionDto[];

  @ApiProperty({
    description: '시작 대여소 정보',
    required: false,
    type: Object,
  })
  startStation?: {
    station_id: string;
    station_name: string;
    lat: number;
    lng: number;
    current_bikes: number;
  };

  @ApiProperty({
    description: '도착 대여소 정보',
    required: false,
    type: Object,
  })
  endStation?: {
    station_id: string;
    station_name: string;
    lat: number;
    lng: number;
    current_bikes: number;
  };
}

export class RoundTripResponseDto {
  @ApiProperty({ description: '왕복 경로들', type: [RoundTripRouteDto] })
  routes: RoundTripRouteDto[];

  @ApiProperty({ description: '처리 시간 (밀리초)' })
  processingTime: number;
}
