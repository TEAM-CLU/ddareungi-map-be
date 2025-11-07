import { RouteDto, CoordinateDto } from '../../routes/dto/route.dto';

/**
 * 경로 타입 정의
 */
export type RouteType =
  | 'direct' // A→B 직접 경로
  | 'multi-leg' // A→경유지→B
  | 'roundtrip' // A→경유지→A (왕복)
  | 'circular'; // A→A (원형, 무작위)

/**
 * Redis에 저장된 네비게이션 경로 데이터 구조
 * - 경로 재검색을 위한 메타데이터 포함
 */
export interface NavigationRouteRedis extends RouteDto {
  /**
   * 경로 타입
   */
  routeType: RouteType;

  /**
   * 최초 출발지 (변경되지 않음)
   */
  origin: CoordinateDto;

  /**
   * 최종 목적지 (변경되지 않음)
   * - 원형/왕복 경로의 경우 origin과 동일
   */
  destination: CoordinateDto;

  /**
   * 경유지 배열 (있는 경우)
   * - 다구간 경로: A→경유지1→경유지2→B
   * - 왕복 경로: A→경유지1→경유지2→A
   * - 원형 경로: 반환점(턴포인트) 좌표들
   */
  waypoints?: CoordinateDto[];

  /**
   * 원형 경로의 목표 거리 (미터, 원형 경로인 경우에만)
   */
  targetDistance?: number;
}
