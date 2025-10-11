import { ApiProperty } from '@nestjs/swagger';
import { CreateStationDto } from './station-api.dto';
import type { StationRawQueryResult } from '../interfaces/station.interfaces';

// 서울시 API 응답을 DTO로 변환
export function mapSeoulStationToDto(
  seoulStation: SeoulBikeStationInfo,
): CreateStationDto {
  // 좌표 파싱 및 검증
  const latitude = parseFloat(seoulStation.STA_LAT);
  const longitude = parseFloat(seoulStation.STA_LONG);

  if (isNaN(latitude) || isNaN(longitude)) {
    throw new Error(
      `서울시 API 응답에서 유효하지 않은 좌표: lat=${seoulStation.STA_LAT}, lng=${seoulStation.STA_LONG}`,
    );
  }

  // 정수 파싱 및 검증
  const totalRacks = parseInt(seoulStation.HOLD_NUM, 10);
  if (isNaN(totalRacks)) {
    throw new Error(
      `서울시 API 응답에서 유효하지 않은 거치대 수: ${seoulStation.HOLD_NUM}`,
    );
  }

  return {
    id: seoulStation.RENT_ID,
    name: seoulStation.RENT_NM,
    number: seoulStation.RENT_NO,
    district: seoulStation.STA_LOC,
    address: `${seoulStation.STA_ADD1} ${seoulStation.STA_ADD2}`.trim(),
    latitude,
    longitude,
    total_racks: totalRacks,
    current_adult_bikes: 0, // API에서 제공하지 않는 정보
  };
}

// 유틸리티 함수: Raw Query 결과를 StationResponseDto로 변환
export function mapRawQueryToStationResponse(
  raw: StationRawQueryResult,
): StationResponseDto {
  // 좌표 파싱 시 NaN 방지
  const latitude = parseFloat(raw.latitude);
  const longitude = parseFloat(raw.longitude);

  if (isNaN(latitude) || isNaN(longitude)) {
    throw new Error(
      `유효하지 않은 좌표 데이터: lat=${raw.latitude}, lng=${raw.longitude}`,
    );
  }

  // 필수 필드 검증
  if (!raw.id || !raw.name) {
    throw new Error('필수 필드(id, name)가 누락되었습니다.');
  }

  const result: StationResponseDto & { distance?: number } = {
    id: raw.id,
    name: raw.name,
    number: raw.number || null,
    latitude,
    longitude,
    total_racks: raw.total_racks,
    current_adult_bikes: raw.current_adult_bikes,
    status: raw.status,
    last_updated_at: raw.last_updated_at,
  };

  // distance 필드가 있으면 추가 (거리 기반 조회 시)
  if (raw.distance !== undefined) {
    const distance = parseFloat(raw.distance);
    if (!isNaN(distance)) {
      result.distance = distance;
    }
  }

  return result;
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

// 실시간 대여정보 응답 (bikeList API)
export interface SeoulBikeRealtimeInfo {
  rackTotCnt: string; // 거치대 개수
  stationName: string; // 보관소(대여소)명
  parkingBikeTotCnt: string; // 자전거 보관 총건수
  shared: string; // 거치율
  stationLatitude: string; // 위도
  stationLongitude: string; // 경도
  stationId: string; // 대여소ID
}

export interface SeoulBikeRealtimeApiResponse {
  rentBikeStatus: {
    list_total_count: number;
    RESULT: {
      CODE: string;
      MESSAGE: string;
    };
    row: SeoulBikeRealtimeInfo[];
  };
}

// 클라이언트 응답 DTO (간소화된 버전)
export class StationResponseDto {
  @ApiProperty({
    description: '대여소 ID (서울시 API 기준)',
    example: 'ST-3060',
  })
  id: string;

  @ApiProperty({
    description: '대여소명',
    example: '여의도공원 대여소',
  })
  name: string;

  @ApiProperty({
    description: '대여소번호',
    required: false,
    example: '101',
    nullable: true,
  })
  number: string | null;

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
    description: '대여소 상태 (자전거 보유 여부 기준)',
    enum: ['available', 'empty', 'inactive'],
    example: 'available',
  })
  status: 'available' | 'empty' | 'inactive';

  @ApiProperty({
    description: '마지막 업데이트 시간',
    required: false,
    example: '2024-10-07T12:00:00Z',
    nullable: true,
  })
  last_updated_at: Date | null;
}

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
 * 서울시 API 대여소 정보를 내부 CreateStationDto로 변환
 */
export function convertSeoulStationToCreateDto(
  seoulStation: SeoulBikeStationInfo,
): CreateStationDto {
  return {
    id: `${seoulStation.RENT_ID}`,
    name: seoulStation.RENT_NM,
    number: seoulStation.RENT_NO,
    district: seoulStation.STA_LOC,
    address: `${seoulStation.STA_ADD1} ${seoulStation.STA_ADD2}`.trim(),
    latitude: parseFloat(seoulStation.STA_LAT),
    longitude: parseFloat(seoulStation.STA_LONG),
    total_racks: parseInt(seoulStation.HOLD_NUM, 10) || 0,
    current_adult_bikes: 0, // API에서 제공하지 않는 정보
  };
}
