import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional } from 'class-validator';
import type { StationStatus, StationId } from '../types/station.types';

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
  current_adult_bikes?: number;
}

/**
 * API 응답용 DTO
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
  current_adult_bikes: number;

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
