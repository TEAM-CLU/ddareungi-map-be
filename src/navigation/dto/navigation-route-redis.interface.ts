import { GraphHopperInstruction } from '../../routes/interfaces/graphhopper.interface';

/**
 * Redis instructions 배열 내 확장 필드(street_ref, last_heading 등) 반영
 */
export interface NavigationGraphHopperInstruction
  extends GraphHopperInstruction {
  street_ref?: string | number;
  last_heading?: number;
  heading?: number;
}

/**
 * Redis에 저장된 네비게이션 경로 데이터 구조 인터페이스
 */
export interface NavigationRouteRedis {
  distance: number;
  weight: number;
  time: number;
  transfers: number;
  points_encoded: boolean;
  bbox: number[];
  points: {
    type: string;
    coordinates: number[][];
  };
  instructions: NavigationGraphHopperInstruction[];
  legs?: unknown[];
  details?: {
    bike_network?: [number, number, string][];
    road_class?: [number, number, string][];
    [key: string]: unknown;
  };
  ascend?: number;
  descend?: number;
  snapped_waypoints?: {
    type: string;
    coordinates: number[][];
  };
  profile?: string;
  bikeRoadRatio?: number;
  routeCategory?: string;
  routeId?: string;
}
