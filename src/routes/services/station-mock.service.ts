import { Injectable } from '@nestjs/common';

export interface MockStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

@Injectable()
export class StationMockService {
  /**
   * 시작 대여소 생성
   */
  generateMockStartStation(
    baseCoordinate: { lat: number; lng: number },
    name?: string,
  ): MockStation {
    return {
      id: '1',
      name: name || '가상 출발 대여소',
      lat: baseCoordinate.lat + 0.001,
      lng: baseCoordinate.lng + 0.001,
    };
  }

  /**
   * 도착 대여소 생성
   */
  generateMockEndStation(
    baseCoordinate: { lat: number; lng: number },
    name?: string,
  ): MockStation {
    return {
      id: '2',
      name: name || '가상 도착 대여소',
      lat: baseCoordinate.lat - 0.001,
      lng: baseCoordinate.lng - 0.001,
    };
  }

  /**
   * 일반 대여소 생성
   */
  generateMockStation(
    baseCoordinate: { lat: number; lng: number },
    name?: string,
    id?: string,
  ): MockStation {
    return {
      id: id || '1',
      name: name || '가상 대여소',
      lat: baseCoordinate.lat + 0.001,
      lng: baseCoordinate.lng + 0.001,
    };
  }
}
