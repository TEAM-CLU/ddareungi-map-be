# 대여소 + 분석

`src/stations/` (따릉이 대여소) + `src/analytics/` (GA4 이벤트).

## 엔드포인트 (`/stations/*`)

### 조회

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/stations` | 전체 / 페이지네이션 |
| `GET` | `/stations/:number` | 단일 대여소 (number = 시 발급 번호) |
| `GET` | `/stations/nearby?lat=&lng=&radius=` | 근처 대여소 |
| `GET` | `/stations/map-area?bbox=...` | 지도 화면 범위 내 |

### 동기화 (관리자)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/stations/sync` | 마스터(전체) 재동기화 |
| `POST` | `/stations/realtime-sync` | 실시간 대여 가능 수 |
| `POST` | `/stations/realtime-sync/batch` | 배치 단위 실시간 동기화 |
| `GET` | `/stations/sync/status` | 마지막 동기화 시각 / 결과 |

### 수동 관리 (관리자)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/stations` | 단건 생성 |
| `DELETE` | `/stations/:number` | 단건 삭제 |
| `DELETE` | `/stations/confirm` | 일괄 삭제 (확인 토큰) |

## 동기화 흐름

서비스 책임 분리 (`src/stations/services/`):

| 서비스 | 책임 |
|--------|------|
| `SeoulApiService` | 서울 열린데이터광장 HTTP 클라이언트 |
| `StationSyncService` | 마스터 동기화 (대여소 메타) |
| `StationRealtimeService` | 실시간 대여 가능 수 |
| `StationBatchRealtimeSyncService` | 배치 단위 실시간 (분할 호출, 병렬) |
| `StationRealtimeLockService` | Redis 분산 락 (중복 동기화 방지) |
| `StationDomainService` | 비즈니스 규칙 (상태 결정 등) |
| `StationMapperService` | API 응답 → 엔티티 변환 |
| `StationQueryService` | 조회 쿼리 (PostGIS `ST_GeomFromGeoJSON`, `ST_AsGeoJSON`) |
| `StationManagementService` | 관리자 수동 CRUD |
| `StationReadFacadeService` | 조회용 facade |
| `StationRequestValidationService` | 요청 파라미터 검증 |

자동 트리거:
- 부팅 시 1회 (`startup_check`) — `StationsService`. 마지막 동기화 시점이 가까우면 스킵
- 스케줄러 (`@nestjs/schedule`) — 주기적 마스터 + 실시간

## 데이터 모델

`src/stations/entities/station.entity.ts`. `location` 컬럼은 PostGIS `geography(Point, 4326)`.

조회 시 `ST_AsGeoJSON("Station"."location")::json AS Station_location` 으로 GeoJSON 변환.

## 알려진 데이터 이슈

서울 API에서 일부 대여소가 좌표 누락(location null)으로 들어옴. INSERT 시 NOT NULL 제약 위반 → `StationSyncService` 가 catch 후 warn 로그 + 다음 건 진행. 마스터 갱신 자체는 계속됨.

## GA4 분석

`src/analytics/`:

| 컴포넌트 | 역할 |
|---------|------|
| `Ga4MeasurementProtocolClient` | `https://www.google-analytics.com/mp/collect` POST |
| `AnalyticsIdentityResolver` | JWT 사용자 ID + 익명 cookie ID 매핑 |
| `AnalyticsService` | `trackEvent()` 진입점 |

호출 위치: NavigationModule (세션 시작/종료/이탈), StationsService (조회 패턴), 기타.

비활성 조건: `GA4_MEASUREMENT_ID` 또는 `GA4_API_SECRET` 둘 중 하나라도 누락 → no-op (예외 던지지 않음).
