# Stations staleness(신선도) 메모

## 용어
- **DB 데이터**: 로컬 DB에 저장된 `stations` 테이블의 `current_bikes`, `status`, `last_updated_at`
- **실시간 데이터**: 서울시 OpenAPI(실시간)에서 조회한 자전거 재고/거치대 정보
- **Staleness**: DB 데이터가 실시간 데이터 대비 얼마나 오래된 상태인지(시간 지연)

## 현재 코드에서 “허용 staleness 상한”을 어떻게 알 수 있나?
결론적으로, **명확한 상한을 보장/추론하기 어렵습니다.**

### 이유 1) `map-area`는 DB-only 설계
- `StationQueryService.findStationsInMapArea`는 주석 그대로 **“DB 데이터만”** 반환합니다.
- 따라서 실시간성은 “요청 시점의 실시간 동기화가 수행되었는지”와 무관하게, DB에 저장된 값이 그대로 노출됩니다.

### 이유 2) 실시간 동기화는 ‘주기’가 아니라 ‘호출 지점’에 의해 발생
실시간 재고 갱신은 대표적으로 아래 코드 경로에서만 일어납니다.
- `StationRealtimeService.syncRealtimeInfoForStations(...)`
- `StationRealtimeService.syncSingleStationRealtimeInfo(...)`
- `StationRealtimeService.syncAllStationsRealtimeInfo(...)`

즉, **“몇 분마다 갱신” 같은 정책값(TTL/스케줄)이 코드로 고정돼 있지 않기 때문에**\n+`map-area`가 반환하는 DB 값의 최신성은 트래픽 패턴/운영 호출 여부에 따라 달라질 수 있습니다.

### 이유 3) `last_updated_at`이 ‘메타데이터 동기화’와 ‘실시간 동기화’에서 모두 갱신됨
- 주간 대여소 메타데이터 동기화(`StationSyncService`)에서도 `last_updated_at = new Date()`를 찍습니다.
- 실시간 동기화(`StationRealtimeService`)에서도 `last_updated_at = new Date()`를 찍습니다.

따라서 `last_updated_at`만 보고 “실시간 재고가 최신인지(혹은 얼마만큼 stale인지)”를 구분하기가 어렵습니다.

## 개선 방향(정책을 명시하고 싶다면)
- **필드 분리**: `realtime_updated_at`(실시간 재고 갱신 시각) 같은 별도 컬럼/필드를 두고, 메타데이터 동기화는 다른 필드로 관리
- **정책 명시**: 예) “지도 화면은 최대 30초 stale 허용” 같은 SLA를 정하고\n+  - `map-area`에 실시간 배치 동기화(비용 큼) 또는\n+  - `stationNumbers` 기반 배치 동기화 엔드포인트를 분리하여 클라이언트가 필요한 범위만 갱신\n+- **캐시/배치 전략**: 서울시 OpenAPI 레이트리밋을 고려해\n+  - 백그라운드 주기 동기화(예: 30초~1분) + `map-area`는 캐시만 읽기\n+  - 또는 “화면에 보이는 대여소 N개”만 배치 갱신\n+
