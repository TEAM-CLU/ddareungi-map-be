import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ArrayNotEmpty,
} from 'class-validator';
import type { StationStatus, StationId } from '../types/station.types';

// 1. 주요 요청/응답 DTO (생성, 조회)

/**
 * API 요청용 DTO
 */
export class CreateStationDto {
  @ApiProperty({
    description: '대여소 고유 ID',
    example: 'ST-1001',
  })
  @IsString()
  id: StationId;

  @ApiProperty({
    description: '대여소 명칭',
    example: '여의도공원 대여소',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: '대여소 번호',
    example: '1001',
    required: false,
  })
  @IsOptional()
  @IsString()
  number?: string | null;

  @ApiProperty({
    description: '위치(구)',
    example: '영등포구',
    required: false,
  })
  @IsOptional()
  @IsString()
  district?: string | null;

  @ApiProperty({
    description: '상세 주소',
    example: '서울시 영등포구 여의동로 68',
    required: false,
  })
  @IsOptional()
  @IsString()
  address?: string | null;

  @ApiProperty({
    description: '위도',
    example: 37.5291,
    minimum: -90,
    maximum: 90,
  })
  @IsNumber()
  latitude: number;

  @ApiProperty({
    description: '경도',
    example: 126.934,
    minimum: -180,
    maximum: 180,
  })
  @IsNumber()
  longitude: number;

  @ApiProperty({
    description: '총 거치대 수',
    example: 20,
    minimum: 0,
  })
  @IsNumber()
  total_racks: number;

  @ApiProperty({
    description: '현재 자전거 수',
    example: 15,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  current_bikes?: number;
}

/**
 * API 응답용 DTO (전체 대여소 조회용)
 */
export class StationResponseDto {
  @ApiProperty({
    description: '대여소 고유 ID',
    example: 'ST-1001',
  })
  id: StationId;

  @ApiProperty({
    description: '대여소 명칭',
    example: '여의도공원 대여소',
  })
  name: string;

  @ApiProperty({
    description: '대여소 번호',
    example: '1001',
    nullable: true,
  })
  number: string | null;

  @ApiProperty({
    description: '위치(구)',
    example: '영등포구',
    nullable: true,
    required: false,
  })
  district?: string | null;

  @ApiProperty({
    description: '상세 주소',
    example: '서울시 영등포구 여의동로 68',
    nullable: true,
    required: false,
  })
  address?: string | null;

  @ApiProperty({
    description: '위도',
    example: 37.5291,
  })
  latitude: number;

  @ApiProperty({
    description: '경도',
    example: 126.934,
  })
  longitude: number;

  @ApiProperty({
    description: '총 거치대 수',
    example: 20,
  })
  total_racks: number;

  @ApiProperty({
    description: '현재 자전거 수',
    example: 15,
  })
  current_bikes: number;

  @ApiProperty({
    description: '대여소 상태',
    enum: ['available', 'empty', 'inactive'],
    example: 'available',
  })
  status: StationStatus;

  @ApiProperty({
    description: '마지막 업데이트 시간',
    example: '2024-10-07T12:00:00Z',
    nullable: true,
  })
  last_updated_at: Date | null;
}

// 2. 실시간/배치/재고 관련 DTO

/**
 * 대여소 번호 목록 DTO (실시간 동기화 등에서 사용)
 */
export class StationNumbersDto {
  @ApiProperty({
    type: [String],
    description: '동기화할 대여소 번호 목록',
    example: [
      '01611',
      '02914',
      '01608',
      '01693',
      '02915',
      '01655',
      '04041',
      '05317',
      '04008',
      '04025',
      '05319',
      '05331',
      '02910',
      '05341',
      '02902',
      '02901',
      '04044',
      '01616',
      '02912',
      '04007',
      '01640',
      '05323',
    ],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  stationNumbers: string[];
}

/**
 * 대여소 재고 조회 요청 DTO
 */
export class StationInventoryRequestDto {
  @ApiProperty({
    description: '대여소 번호 배열',
    example: ['1001', '1002', '1003'],
    type: [String],
  })
  @IsArray()
  stationNumbers: string[];
}

/**
 * 대여소 재고 조회 응답 DTO
 */
export class StationInventoryResponseDto {
  @ApiProperty({
    description: '대여소 번호',
    example: '1001',
  })
  station_number: string;

  @ApiProperty({
    description: '현재 가용 가능한 자전거 수',
    example: 8,
  })
  current_bikes: number;
}

// 3. 기타(근처 대여소 등)

/**
 * 근처 대여소 및 지도 영역 조회용 응답 DTO (실시간 정보, 거리, 주소 포함)
 */
export class NearbyStationResponseDto {
  @ApiProperty({
    description: '대여소 이름',
    example: '신촌역 1번출구 앞',
  })
  name: string;

  @ApiProperty({
    description: '대여소 번호',
    example: '05306',
    required: false,
    nullable: true,
  })
  number: string | null;

  @ApiProperty({
    description: '상세 주소',
    example: '서울시 마포구 신촌로 176',
    nullable: true,
    required: false,
  })
  address?: string | null;

  @ApiProperty({
    description: '위도',
    example: 37.5665,
    type: Number,
  })
  latitude: number;

  @ApiProperty({
    description: '경도',
    example: 126.978,
    type: Number,
  })
  longitude: number;

  @ApiProperty({
    description: '현재 자전거 수',
    example: 15,
  })
  current_bikes: number;

  @ApiProperty({
    description: '현재 위치로부터의 거리 (미터)',
    example: 240,
    type: Number,
    required: false,
  })
  distance?: number;
}
