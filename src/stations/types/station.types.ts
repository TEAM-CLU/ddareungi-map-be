/**
 * Station 도메인 기본 타입 정의
 * 원시 타입, 유니온 타입만 포함
 */

// ============================================
// 기본 타입 정의
// ============================================

export type StationStatus = 'available' | 'empty' | 'inactive';

export type StationId = string;

// ============================================
// 함수 타입 정의
// ============================================

// 상태 계산 함수 타입
export type StatusCalculator = (
  current_bikes: number,
  total_racks: number,
  isOperating: boolean,
) => StationStatus;
