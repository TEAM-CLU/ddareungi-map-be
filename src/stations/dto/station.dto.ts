import { ApiProperty } from '@nestjs/swagger';
import { CreateStationDto } from './station-api.dto';

/**
 * 서울시 API 응답을 CreateStationDto로 변환
 */
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
    current_bikes: 0, // API에서 제공하지 않는 정보
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
    current_bikes: 0, // API에서 제공하지 않는 정보
  };
}
