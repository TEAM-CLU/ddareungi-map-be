# Benchmark Comparison Guide

## 목표

이 벤치마크는 아래 3가지를 수치로 비교하기 위한 문서와 실행 도구를 제공합니다.

1. 지도 기반 대여소 조회
   - `legacy`: `/stations/map-area` 안에서 DB 조회와 실시간 동기화를 함께 수행
   - `split`: `/stations/map-area`로 DB 조회 후 `/stations/realtime-sync/batch`로 실시간 동기화를 분리
2. Redis 분산 락
   - `without_lock`: split 구조이지만 락 비활성화
   - `with_lock`: split 구조 + Redis 분산 락 활성화
3. TTS 합성 전략
   - `fulltext_supabase`: 문장 전체를 한 번에 합성하고 Supabase Storage에 저장
   - `chunked_supabase`: 안내 문장을 분해해 청크 단위로 재사용하고 merged 파일을 생성
4. Clustered 대여소 조회 / 락 비교
   - `single_hotspot`: 단일 고정 좌표 기반 비교
   - `clustered_hotspots`: 노원권 5개 hotspot 기반 seeded 랜덤 비교

## 측정 항목

### 지도 조회

- `map_only_latency_ms`
- `end_to_end_latency_ms`
- 반환 대여소 수
- 서울시 실시간 API 실제 호출 수
- 요청 1회당 평균 외부 API 호출 수

### Redis 분산 락

- `station_sync_requested_total`
- `station_lock_acquired_total`
- `station_lock_skipped_total`
- `seoul_realtime_fetch_started_total`
- 요청 대비 실제 외부 API 호출 감소율
- `end_to_end avg(ms)`
- `p95(ms)`

### TTS

- 경로별 instruction 수
- 경로별 unique instruction text 수
- `google_tts_synthesize_chars_total`
- `google_tts_synthesize_total`
- `tts_fulltext_synthesized_total`
- `tts_chunk_synthesized_total`
- `tts_chunk_cache_hit_total`
- `tts_merged_cache_hit_total`
- `tts_merged_created_total`

## 실행 전 준비

아래 환경이 모두 준비되어 있어야 실제 벤치마크가 동작합니다.

- PostgreSQL / PostGIS
- Redis
- Seoul Open API
- GraphHopper
- Google Cloud TTS
- Supabase Storage
- `ffmpeg`

필수 환경 변수 예시는 아래와 같습니다.

- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`
- `REDIS_HOST`, `REDIS_PORT`
- `SEOUL_OPEN_API_KEY`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY`

## 실행 방법

### 전체 실행

루트에서 아래 명령을 실행하면 대여소 벤치마크와 TTS 벤치마크를 순차 실행합니다.

```bash
pnpm benchmark
```

또는 아래 명령도 동일합니다.

```bash
pnpm benchmark:all
```

### 대여소 조회 / Redis 락만 실행

```bash
pnpm benchmark:stations
```

### Clustered 대여소 조회 / Redis 락만 실행

```bash
pnpm benchmark:stations:clustered
```

### TTS만 실행

```bash
pnpm benchmark:tts
```

## 실행 흐름

### `pnpm benchmark:stations`

기본 동작은 다음과 같습니다.

1. `pnpm run build`를 자동 실행합니다.
2. 서버를 `map_legacy`, `map_split_no_lock`, `map_split_with_lock` 모드로 순차 기동합니다.
3. 내부 `/internal/benchmark/reset` 호출로 카운터를 초기화합니다.
4. 지도 조회 비교를 수행합니다.
5. Redis 락 비교를 수행합니다.
6. 결과를 timestamp가 포함된 파일로 저장합니다.

### `pnpm benchmark:stations:clustered`

기본 동작은 다음과 같습니다.

1. `pnpm run build`를 자동 실행합니다.
2. 노원권 5개 hotspot을 기준으로 clustered request trace를 생성합니다.
3. `BENCHMARK_CLUSTER_SEED` 기반 seeded 랜덤으로 radius별 request plan을 만듭니다.
4. `map_legacy`, `map_split_no_lock`, `map_split_with_lock`가 같은 trace를 재생합니다.
5. `legacy`는 `inline` 순차 동기화, `split`은 `batch_parallel` 제한 병렬 동기화를 사용합니다.
6. map suite와 lock suite를 각각 수행합니다.
7. 결과를 timestamp가 포함된 파일로 저장합니다.

현재 clustered hotspot은 아래 5개입니다.

- `gongneung_center`: `37.630032, 127.076508`
- `nowon_station`: `37.655349, 127.060187`
- `seoultech`: `37.631668, 127.077481`
- `seoul_womens_univ`: `37.628114, 127.090549`
- `sahmyook_univ`: `37.642561, 127.105918`

### `pnpm benchmark:tts`

기본 동작은 다음과 같습니다.

1. `pnpm run build`를 자동 실행합니다.
2. 서버를 `tts_fulltext_supabase`, `tts_chunked_supabase` 모드로 순차 기동합니다.
3. suite 시작 시 Redis/Supabase 캐시를 초기화합니다.
4. 같은 3개 경로를 `cold` phase로 1회 실행합니다.
5. reset 없이 같은 3개 경로를 `warm` phase로 다시 실행합니다.
6. 결과를 timestamp가 포함된 파일로 저장합니다.

### `pnpm benchmark` / `pnpm benchmark:all`

기본 동작은 다음과 같습니다.

1. 공통 timestamp를 하나 생성합니다.
2. `run-stations.mjs`를 실행합니다.
3. `run-tts.mjs`를 실행합니다.
4. 두 결과 파일 경로를 가리키는 통합 인덱스 파일을 추가로 저장합니다.

포트를 바꿔 실행하려면:

```bash
BENCHMARK_PORT=3100 pnpm benchmark:stations
```

clustered seed를 바꿔 다른 trace를 재현하려면:

```bash
BENCHMARK_CLUSTER_SEED=20260317 pnpm benchmark:stations:clustered
```

로그를 더 간결하게 보려면:

```bash
BENCHMARK_RELAY_SERVER_OUTPUT=false pnpm benchmark
```

긴 구간에서 진행 로그 주기를 바꾸려면:

```bash
BENCHMARK_PROGRESS_INTERVAL_MS=5000 pnpm benchmark
```

빠르게 테스트만 해보려면 반복 수를 줄일 수 있습니다.

```bash
BENCHMARK_MAP_ITERATIONS=2 BENCHMARK_LOCK_CONCURRENCY=2 pnpm benchmark:stations
```

split 병렬 동기화 병렬도를 바꾸려면:

```bash
BENCHMARK_REALTIME_SYNC_CONCURRENCY=8 pnpm benchmark:stations
```

clustered 스크립트를 빠르게 검증하려면:

```bash
BENCHMARK_RELAY_SERVER_OUTPUT=false BENCHMARK_MAP_ITERATIONS=2 BENCHMARK_LOCK_CONCURRENCY=4 BENCHMARK_REALTIME_SYNC_CONCURRENCY=8 pnpm benchmark:stations:clustered
```

## 산출물

모든 결과 파일은 루트가 아니라 `benchmark-results/` 아래에 저장됩니다.

### 대여소 조회 / Redis 락

- `benchmark-results/stations-benchmark-YYYYMMDD-HHmmss.json`
- `benchmark-results/stations-benchmark-YYYYMMDD-HHmmss.md`

### Clustered 대여소 조회 / Redis 락

- `benchmark-results/stations-clustered-benchmark-YYYYMMDD-HHmmss.json`
- `benchmark-results/stations-clustered-benchmark-YYYYMMDD-HHmmss.md`

### TTS

- `benchmark-results/tts-benchmark-YYYYMMDD-HHmmss.json`
- `benchmark-results/tts-benchmark-YYYYMMDD-HHmmss.md`

### 통합 실행 인덱스

- `benchmark-results/benchmark-all-YYYYMMDD-HHmmss.json`
- `benchmark-results/benchmark-all-YYYYMMDD-HHmmss.md`

`pnpm benchmark` 또는 `pnpm benchmark:all`로 실행하면 stations, tts, 통합 인덱스 파일이 같은 timestamp로 함께 생성됩니다.

## 스크립트 구조

- `scripts/benchmark/run-stations.mjs`
  - 지도 조회 비교 + Redis 락 비교만 수행
- `scripts/benchmark/run-stations-clustered.mjs`
  - 노원권 5개 hotspot 기반 clustered map/lock 비교 수행
- `scripts/benchmark/run-tts.mjs`
  - TTS 전용 cold/warm 벤치마크만 수행
- `scripts/benchmark/run-all.mjs`
  - stations → tts 순서로 실행하고 결과 파일 경로를 인덱싱
- `scripts/benchmark/_shared.mjs`
  - timestamp, output path, 공통 로거, 공통 benchmark 환경 값 관리

## 구현 메모

- 내부 계측 엔드포인트
  - `POST /internal/benchmark/reset`
  - `GET /internal/benchmark/snapshot`
- 내부 시나리오 엔드포인트
  - `POST /internal/benchmark/scenarios/map-area/query`
  - `POST /internal/benchmark/scenarios/map-area/end-to-end`
  - `POST /internal/benchmark/scenarios/navigation/start`
- Redis 락 전환
  - `STATION_REALTIME_LOCK_ENABLED=true|false`
- TTS 전략 전환
  - `TTS_SYNTHESIS_MODE=fulltext|chunked`
- timestamp 공유
  - `BENCHMARK_TIMESTAMP`
- clustered trace 제어
  - `BENCHMARK_CLUSTER_SEED`
- split 병렬 동기화 worker 수
  - `BENCHMARK_REALTIME_SYNC_CONCURRENCY`

## TTS 벤치마크 해석 메모

- 현재 chunked 구조는 `Redis phrase cache -> merged storage -> chunk storage` 순서의 계층형 캐시입니다.
- 따라서 `warm` phase에서 같은 문장이 다시 요청되면 대부분 Redis hit으로 끝나므로, `tts_merged_cache_hit_total`이 0인 것이 이상한 값은 아닙니다.
- `tts_merged_cache_hit_total`은 Redis record가 없지만 Supabase의 merged 파일은 남아 있는 상황에서 의미가 있습니다.
- 일반적인 warm 재실행에서는 아래 흐름이 더 중요합니다.
  - `google_tts_synthesize_total` 감소
  - `google_tts_synthesize_chars_total` 감소
  - route latency 감소
- chunked의 warm phase에서 `tts_chunk_cache_hit_total`이나 `tts_merged_cache_hit_total`이 반드시 올라야 하는 것은 아닙니다. 상위 Redis 캐시가 먼저 요청을 종료할 수 있기 때문입니다.

## 설계 메모

- 벤치마크용 오케스트레이션은 `common/benchmark` 아래로 분리했습니다.
- 원래 도메인 서비스는 그대로 두고, benchmark 전용 서비스가 이를 조합해 legacy/split 시나리오를 재현합니다.
- 현재 station benchmark에서 `legacy`는 순차 `inline`, `split`은 제한 병렬 `batch_parallel`을 사용합니다.
- 운영 환경에서도 관리자용 `POST /stations/realtime-sync`, `POST /stations/realtime-sync/batch`는 `STATION_REALTIME_SYNC_CONCURRENCY` 기준 제한 병렬을 사용하며, 값이 없거나 잘못되면 기본값 `8`을 사용합니다.
- 반대로 사용자 조회 경로(`nearby`, `detail`)는 외부 API 압력을 갑자기 키우지 않도록 순차 동기화를 유지합니다.
- 따라서 벤치마크 스크립트는 일반 사용자 API 대신 내부 benchmark 엔드포인트만 호출합니다.
- 통합 실행 스크립트는 하위 결과를 재계산하지 않고 결과 파일 경로만 인덱싱합니다.
- clustered 스크립트는 기존 단일 hotspot 스크립트를 대체하지 않고, 더 현실적인 락 비교용으로 별도 유지합니다.
- clustered 스크립트는 `without_lock` / `with_lock`에 동일한 request plan을 재생해 공정성을 확보합니다.

## 결과 해석 포인트

- 지도 조회는 `split`의 `map_only_latency_ms`가 `legacy` end-to-end보다 낮아야 합니다.
- `split` end-to-end가 `legacy`보다 큰 폭으로 빨라지지 않을 수 있습니다. 총 외부 실시간 API 호출 수는 같고, 응답시간은 DB 조회보다 서울시 API latency, timeout, provider queueing/rate-limit 영향이 더 크게 지배하기 때문입니다.
- Redis 락은 `with_lock`에서 `station_lock_skipped_total > 0` 이어야 하고, `seoul_realtime_fetch_started_total`이 `without_lock`보다 작아야 합니다.
- clustered 락 비교에서는 hotspot usage가 함께 저장되므로, 같은 trace가 재생됐는지 먼저 확인해야 합니다.
- clustered 락 비교에서는 외부 API 호출 감소율뿐 아니라 `end_to_end avg(ms)`, `p95(ms)`도 같이 봐야 합니다.
- TTS는 cold/warm을 나눠서 해석해야 합니다.
- cold phase에서는 chunked가 chunk/merge 준비 비용 때문에 더 느릴 수 있습니다.
- warm phase에서는 `google_tts_synthesize_total`, `google_tts_synthesize_chars_total`, route latency가 cold보다 줄어드는지를 우선 봅니다.
