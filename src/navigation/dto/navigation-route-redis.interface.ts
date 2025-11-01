import { RouteDto } from '../../routes/dto/route.dto';

/**
 * Redis에 저장된 네비게이션 경로 데이터 구조
 * - RouteDto 형태로 저장됨 (여러 segments 포함)
 * - 각 segment는 type(walking/biking)과 instructions를 가짐
 */
export type NavigationRouteRedis = RouteDto;
