/**
 * Station 도메인 인터페이스 정의
 * 비즈니스 로직 계약 및 복합 타입 구조 정의
 */

import { StationStatus, StationId } from '../types/station.types';

// ============================================
// 좌표 관련 인터페이스
// ============================================

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface StationLocation extends Coordinates {
  isValid(): boolean;
}

// ============================================
// 대여소 정보 인터페이스
// ============================================

// 대여소 기본 정보
export interface StationBasicInfo {
  id: StationId;
  name: string;
  number?: string | null;
  district?: string | null;
  address?: string | null;
}

// 대여소 운영 정보
export interface StationOperationInfo {
  total_racks: number;
  current_bikes: number;
  status: StationStatus;
  last_updated_at: Date | null;
}

// 완전한 대여소 정보
export interface StationInfo
  extends StationBasicInfo,
    StationOperationInfo,
    Coordinates {}

// ============================================
// 쿼리 관련 인터페이스
// ============================================

// TypeORM Raw Query 결과 타입 정의 (DB 호환성)
export interface StationRawQueryResult {
  id: string;
  name: string;
  number?: string | null;
  district?: string | null;
  address?: string | null;
  total_racks: number;
  current_bikes: number;
  status: 'available' | 'empty' | 'inactive';
  last_updated_at: Date | null;
  latitude: string; // PostGIS ST_Y 결과는 string으로 반환
  longitude: string; // PostGIS ST_X 결과는 string으로 반환
}

// ============================================
// 서비스 계층 인터페이스
// ============================================

// GeoJSON 인터페이스
export interface GeoJsonFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  properties: {
    id: string;
    name: string;
    total_racks: number;
    current_bikes: number;
    status: StationStatus;
    last_updated_at: string | null;
  };
}

export interface GeoJsonResponse {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

// 동기화 결과 인터페이스
export interface SyncResult {
  totalProcessed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  startTime: Date;
  endTime: Date;
  duration: number;
}

// 실시간 업데이트 데이터 인터페이스
export interface RealtimeUpdateData {
  [key: string]: {
    current_bikes: number;
    total_racks: number;
    last_updated_at: Date;
  };
}

// 전체 삭제 결과 인터페이스
export interface DeleteAllResult {
  deleted: number;
  deletedCount: number; // 호환성을 위한 별칭
  success: boolean;
  message?: string;
}
