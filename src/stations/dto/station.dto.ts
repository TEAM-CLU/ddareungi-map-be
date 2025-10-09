import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsDateString } from 'class-validator';

// TypeORM Raw Query 결과 타입 정의
export interface StationRawQueryResult {
  station_station_id: string;
  station_external_station_id: string | null;
  station_station_name: string;
  station_station_number: string | null;
  station_district: string | null;
  station_address: string | null;
  station_total_racks: number;
  station_current_adult_bikes: number;
  station_last_updated_at: Date | null;
  latitude: string; // PostGIS ST_Y 결과는 string으로 반환
  longitude: string; // PostGIS ST_X 결과는 string으로 반환
  distance?: string; // 거리 계산 시 추가되는 필드
}

// Base Coordinate DTO - 좌표 관련 공통 DTO
export class BaseCoordinateDto {
  @ApiProperty({
    description: '위도 (WGS84)',
    example: 37.5665,
    minimum: -90,
    maximum: 90,
  })
  @IsNumber()
  latitude: number;

  @ApiProperty({
    description: '경도 (WGS84)',
    example: 126.978,
    minimum: -180,
    maximum: 180,
  })
  @IsNumber()
  longitude: number;
}

// 지도 영역 검색을 위한 DTO
export class MapAreaSearchDto extends BaseCoordinateDto {
  @ApiProperty({
    description: '검색 반경 (미터)',
    example: 2000,
    minimum: 100,
    maximum: 20000,
  })
  @IsNumber()
  radius: number;
}

// 유틸리티 함수: Raw Query 결과를 StationResponseDto로 변환
export function mapRawQueryToStationResponse(
  raw: StationRawQueryResult,
): StationResponseDto {
  return {
    station_id: raw.station_station_id,
    external_station_id: raw.station_external_station_id,
    station_name: raw.station_station_name,
    station_number: raw.station_station_number,
    district: raw.station_district,
    address: raw.station_address,
    latitude: parseFloat(raw.latitude),
    longitude: parseFloat(raw.longitude),
    total_racks: raw.station_total_racks,
    current_adult_bikes: raw.station_current_adult_bikes,
    last_updated_at: raw.station_last_updated_at,
  };
}

// 서울시 API 기본 응답 구조
export interface SeoulApiBaseResponse {
  RESULT: {
    CODE: string;
    MESSAGE: string;
  };
}

// 서울시 API 성공 응답
export interface SeoulApiSuccessResponse<T = any> extends SeoulApiBaseResponse {
  list_total_count: number;
  row: T[];
}

// 서울시 API 오류 응답
export interface SeoulApiErrorResponse extends SeoulApiBaseResponse {
  error?: string; // 추가적인 오류 정보
}

// 서울시 API 전체 응답 (성공/오류 구분)
export type SeoulApiResponse<T = any> =
  | SeoulApiSuccessResponse<T>
  | SeoulApiErrorResponse;

// 서울시 API 래퍼 응답 (stationInfo 키로 감싸진 형태)
export interface SeoulApiWrapperResponse<T = any> {
  stationInfo?: SeoulApiResponse<T>;
  RESULT?: SeoulApiBaseResponse['RESULT']; // 직접 오류 응답인 경우
}

// 서울시 대여소 정보 (raw API response)
export class SeoulBikeStationInfo {
  @ApiProperty({ description: '대여소그룹명' })
  STA_LOC: string;

  @ApiProperty({ description: '대여소ID' })
  RENT_ID: string;

  @ApiProperty({ description: '대여소번호' })
  RENT_NO: string;

  @ApiProperty({ description: '대여소명' })
  RENT_NM: string;

  @ApiProperty({ description: '대여소번호명' })
  RENT_ID_NM: string;

  @ApiProperty({ description: '거치대수' })
  HOLD_NUM: string;

  @ApiProperty({ description: '주소1' })
  STA_ADD1: string;

  @ApiProperty({ description: '주소2' })
  STA_ADD2: string;

  @ApiProperty({ description: '위도' })
  STA_LAT: string;

  @ApiProperty({ description: '경도' })
  STA_LONG: string;
}

// 서울시 API 응답 DTO (이전 버전과의 호환성을 위해 유지)
export class SeoulBikeStationApiResponse
  implements SeoulApiSuccessResponse<SeoulBikeStationInfo>
{
  @ApiProperty({ description: '총 데이터 건수' })
  list_total_count: number;

  @ApiProperty({ description: '요청 결과' })
  RESULT: {
    CODE: string;
    MESSAGE: string;
  };

  @ApiProperty({ description: '대여소 정보 목록' })
  row: SeoulBikeStationInfo[];
}

// 클라이언트 응답 DTO
export class StationResponseDto {
  @ApiProperty({
    description: '대여소 ID',
    example: 'ST-1001',
  })
  station_id: string;

  @ApiProperty({
    description: '외부 대여소 ID (서울시 API)',
    required: false,
    example: 'SPB-1001',
    nullable: true,
  })
  external_station_id: string | null;

  @ApiProperty({
    description: '대여소명',
    example: '여의도공원 대여소',
  })
  station_name: string;

  @ApiProperty({
    description: '대여소번호',
    required: false,
    example: '101',
    nullable: true,
  })
  station_number: string | null;

  @ApiProperty({
    description: '구/동 정보',
    required: false,
    example: '영등포구',
    nullable: true,
  })
  district: string | null;

  @ApiProperty({
    description: '주소',
    required: false,
    example: '서울시 영등포구 여의도동 88-3',
    nullable: true,
  })
  address: string | null;

  @ApiProperty({
    description: '위도 (WGS84)',
    example: 37.5273,
    minimum: -90,
    maximum: 90,
  })
  latitude: number;

  @ApiProperty({
    description: '경도 (WGS84)',
    example: 126.9247,
    minimum: -180,
    maximum: 180,
  })
  longitude: number;

  @ApiProperty({
    description: '총 거치대 수',
    example: 20,
    minimum: 0,
  })
  total_racks: number;

  @ApiProperty({
    description: '현재 이용 가능한 자전거 수',
    example: 15,
    minimum: 0,
  })
  current_adult_bikes: number;

  @ApiProperty({
    description: '마지막 업데이트 시간',
    required: false,
    example: '2024-10-07T12:00:00Z',
    nullable: true,
  })
  last_updated_at: Date | null;
}

// 대여소 생성/업데이트 DTO
export class CreateStationDto {
  @ApiProperty({
    description: '대여소 ID',
    example: 'ST-1001',
  })
  @IsString()
  station_id: string;

  @ApiProperty({
    description: '외부 대여소 ID (서울시 API)',
    required: false,
    example: 'SPB-1001',
  })
  @IsOptional()
  @IsString()
  external_station_id?: string;

  @ApiProperty({
    description: '대여소명',
    example: '여의도공원 대여소',
  })
  @IsString()
  station_name: string;

  @ApiProperty({
    description: '대여소번호',
    required: false,
    example: '101',
  })
  @IsOptional()
  @IsString()
  station_number?: string;

  @ApiProperty({
    description: '구/동 정보',
    required: false,
    example: '영등포구',
  })
  @IsOptional()
  @IsString()
  district?: string;

  @ApiProperty({
    description: '주소',
    required: false,
    example: '서울시 영등포구 여의도동 88-3',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({
    description: '위도 (WGS84)',
    example: 37.5273,
    minimum: -90,
    maximum: 90,
  })
  @IsNumber()
  latitude: number;

  @ApiProperty({
    description: '경도 (WGS84)',
    example: 126.9247,
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
    description: '현재 이용 가능한 자전거 수',
    required: false,
    example: 15,
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  current_adult_bikes?: number;

  @ApiProperty({
    description: '마지막 업데이트 시간',
    required: false,
    example: '2024-10-07T12:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  last_updated_at?: Date;
}

// 대여소 검색 DTO
export class StationSearchDto {
  @ApiProperty({
    description: '검색할 위도 (WGS84)',
    example: 37.5665,
    minimum: -90,
    maximum: 90,
  })
  @IsNumber()
  latitude: number;

  @ApiProperty({
    description: '검색할 경도 (WGS84)',
    example: 126.978,
    minimum: -180,
    maximum: 180,
  })
  @IsNumber()
  longitude: number;

  @ApiProperty({
    description: '검색 반경 (미터)',
    required: false,
    default: 1000,
    example: 1000,
    minimum: 100,
    maximum: 10000,
  })
  @IsOptional()
  @IsNumber()
  radius?: number = 1000;

  @ApiProperty({
    description: '반환할 최대 개수',
    required: false,
    default: 10,
    example: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  limit?: number = 10;
}

// ===========================================
// 유틸리티 함수들
// ===========================================

/**
 * 서울시 API 응답이 성공 응답인지 확인하는 타입 가드
 */
export function isSeoulApiSuccessResponse<T>(
  response: SeoulApiResponse<T>,
): response is SeoulApiSuccessResponse<T> {
  return 'list_total_count' in response && 'row' in response;
}

/**
 * 서울시 API 응답이 오류 응답인지 확인하는 타입 가드
 */
export function isSeoulApiErrorResponse(
  response: SeoulApiResponse,
): response is SeoulApiErrorResponse {
  return !isSeoulApiSuccessResponse(response);
}

/**
 * 서울시 API 응답의 RESULT 코드가 성공인지 확인
 */
export function isSeoulApiResultSuccess(
  result: SeoulApiBaseResponse['RESULT'],
): boolean {
  return result.CODE === 'INFO-000';
}

/**
 * Raw Query 결과를 StationResponseDto로 안전하게 변환
 */
export function convertRawToStationResponse(
  raw: StationRawQueryResult,
): StationResponseDto {
  return {
    station_id: raw.station_station_id,
    external_station_id: raw.station_external_station_id,
    station_name: raw.station_station_name,
    station_number: raw.station_station_number,
    district: raw.station_district,
    address: raw.station_address,
    latitude: parseFloat(raw.latitude),
    longitude: parseFloat(raw.longitude),
    total_racks: raw.station_total_racks,
    current_adult_bikes: raw.station_current_adult_bikes,
    last_updated_at: raw.station_last_updated_at,
  };
}

/**
 * 서울시 API 대여소 정보를 내부 CreateStationDto로 변환
 */
export function convertSeoulStationToCreateDto(
  seoulStation: SeoulBikeStationInfo,
): CreateStationDto {
  return {
    station_id: `ST-${seoulStation.RENT_ID}`,
    external_station_id: seoulStation.RENT_ID,
    station_name: seoulStation.RENT_NM,
    station_number: seoulStation.RENT_NO,
    district: seoulStation.STA_LOC,
    address: `${seoulStation.STA_ADD1} ${seoulStation.STA_ADD2}`.trim(),
    latitude: parseFloat(seoulStation.STA_LAT),
    longitude: parseFloat(seoulStation.STA_LONG),
    total_racks: parseInt(seoulStation.HOLD_NUM, 10) || 0,
    current_adult_bikes: 0, // API에서 제공하지 않는 정보
  };
}
