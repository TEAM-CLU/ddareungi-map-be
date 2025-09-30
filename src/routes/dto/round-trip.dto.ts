import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  CoordinateDto,
  SummaryDto,
  BoundingBoxDto,
  GeometryDto,
  InstructionDto,
  BikeProfile,
} from './full-journey.dto';

export class RoundTripSearchRequestDto {
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

  @ApiProperty({
    description: '자전거 프로필 (선택사항)',
    enum: BikeProfile,
    required: false,
  })
  @IsOptional()
  @IsEnum(BikeProfile)
  profile?: BikeProfile;
}

export class RoundTripRecommendRequestDto {
  @ApiProperty({ description: '출발지 좌표', type: CoordinateDto })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CoordinateDto)
  start: CoordinateDto;

  @ApiProperty({ description: '목표 거리 (킬로미터)' })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  targetDistance: number;

  @ApiProperty({
    description: '자전거 프로필',
    enum: BikeProfile,
    required: false,
  })
  @IsOptional()
  @IsEnum(BikeProfile)
  profile?: BikeProfile;

  @ApiProperty({
    description: '시드값 (선택사항)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  seed?: number;
}

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
