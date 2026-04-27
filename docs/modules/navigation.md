# 경로·네비게이션

`src/routes/` (경로 계산) + `src/navigation/` (실시간 세션) + `src/map/` (정적 페이지) + `src/location/` (Kakao Map 검색).

## 엔드포인트

### 경로 계산 (`/routes/*`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/routes/full-journey` | 출발지 → 도착지 (자전거 + 도보 조합) |
| `POST` | `/routes/circular-journey` | 출발지 회귀 (라이딩 코스) |

요청 바디는 `src/routes/dto/route.dto.ts`. `profile`은 `safe_bike` / `fast_bike` 중 선택.

### 실시간 네비게이션 세션 (`/navigation/*`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/navigation/start` | 세션 시작 (경로 결과 받아서) |
| `POST` | `/navigation/:sessionId/heartbeat` | 위치 업데이트 + 다음 안내 응답 |
| `POST` | `/navigation/:sessionId/return` | 경로 이탈 시 복귀 가이드 |
| `POST` | `/navigation/:sessionId/reroute` | 새 경로 재계산 |
| `DELETE` | `/navigation/:sessionId` | 종료 |

**테스트용** (운영 차단 또는 관리자 전용):
- `GET /navigation/test/session/:sessionId`
- `GET /navigation/test/route/:routeId`
- `GET /navigation/test/session/:sessionId/with-route`

### 위치 검색 (`/locations/*`)

| 메서드 | 경로 | 백엔드 |
|--------|------|--------|
| `GET` | `/locations/keyword?query=...` | Kakao Map keyword search |
| `GET` | `/locations/address?query=...` | Kakao Map address search |
| `GET` | `/locations/coord2address?lat=...&lng=...` | Kakao Map reverse geocoding |

`KAKAO_MAP_API` 환경변수 필요.

### 정적 페이지 (`/map`, `/auth_result.*`)

`src/map/map.controller.ts`. `public/` 디렉터리의 HTML/JS 서빙. OAuth 콜백 후 클라이언트 리다이렉트 페이지 등.

## 경로 계산 흐름 (RoutesService)

자전거 라이딩은 거의 항상 **도보 + 자전거 + 도보** 다단 조합:

```
출발지 ─(foot)→ 출발 대여소 ─(safe_bike|fast_bike)→ 도착 대여소 ─(foot)→ 도착지
```

`src/routes/services/routes.service.ts` 가:
1. 출발/도착 좌표 근처 대여소 후보 K개 추출 (`StationsService`)
2. 각 후보 쌍에 대해 GraphHopper 다중 호출 (foot 두 구간 + bike 한 구간)
3. 총 시간/거리/안전성 종합해 최적 조합 선택
4. `RouteConverter` 가 GraphHopper 응답을 클라이언트 DTO 로 정제

GraphHopper 호출은 `src/routes/services/graphhopper.service.ts`. 다중 프로파일은 `getMultipleRoutes()` 로 동시 호출 후 비교.

## 네비게이션 세션 (NavigationModule)

세션 상태는 **Redis**에 보관 (단일 EC2지만 컨테이너 재시작 시 살아남도록).

서비스 분리:
- `NavigationSessionService` — Redis CRUD
- `NavigationHelperService` — 진행도 계산, 다음 안내 생성, 거리 계산
- `NavigationRerouteService` — 이탈 감지 후 새 경로 GraphHopper 호출
- `NavigationReturnService` — 짧게 이탈 시 원 경로 복귀 가이드
- `NavigationEndService` — 종료 시 stats 업데이트 + 분석 이벤트

세션 종료 시:
- `UserStats` 업데이트
- `AnalyticsService` 로 GA4 이벤트 송신

## 호출 그래프

```
RoutesController ─ RoutesService ─┬─ StationsService (대여소 후보)
                                  ├─ GraphHopperService (HTTP)
                                  └─ RouteConverter (응답 정제)

NavigationController ─ NavigationSessionService ─ Redis
                     ├ NavigationHelperService ─ Redis
                     ├ NavigationRerouteService ─ GraphHopperService
                     ├ NavigationReturnService ─ GraphHopperService
                     └ NavigationEndService ─ UserStatsService + AnalyticsService
```
