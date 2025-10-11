import { Injectable } from '@nestjs/common';
import { StationStatus, StatusCalculator } from '../types/station.types';
import { StationOperationInfo } from '../interfaces/station.interfaces';

/**
 * 대여소 상태 계산 및 비즈니스 로직 전담 서비스
 * - 순수 도메인 로직만 담당
 * - 외부 의존성 없음
 */
@Injectable()
export class StationDomainService {
  /**
   * 대여소 상태 계산 - 핵심 비즈니스 로직
   */
  calculateStationStatus: StatusCalculator = (
    current_bikes: number,
    total_racks: number,
    isOperating: boolean = true,
  ): StationStatus => {
    // 운영 중단된 경우
    if (!isOperating) {
      return 'inactive';
    }

    // 자전거 수를 기준으로 상태 결정
    return current_bikes > 0 ? 'available' : 'empty';
  };

  /**
   * 운영 정보 기반 상태 계산
   */
  calculateStatusFromOperationInfo(
    operationInfo: Partial<StationOperationInfo>,
    isOperating: boolean = true,
  ): StationStatus {
    const currentBikes = operationInfo.current_adult_bikes || 0;
    const totalRacks = operationInfo.total_racks || 0;

    return this.calculateStationStatus(currentBikes, totalRacks, isOperating);
  }

  /**
   * 좌표 유효성 검증
   */
  isValidCoordinates(latitude: number, longitude: number): boolean {
    return (
      !isNaN(latitude) &&
      !isNaN(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180 &&
      !(latitude === 0 && longitude === 0) // [0,0] 좌표 제외
    );
  }
}
