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

루트에서 아래 명령을 실행합니다.

```bash
pnpm benchmark
```

TTS만 별도로 보고 싶다면:

```bash
pnpm benchmark:tts
```

기본 동작은 다음과 같습니다.

1. 서버를 benchmark 모드로 순차 기동
   - 실행 전 `pnpm run build`를 자동 수행
2. 내부 `/internal/benchmark/reset` 호출로 카운터 초기화
3. 내부 benchmark scenario 엔드포인트로 지도 조회 비교 실행
4. 내부 benchmark scenario 엔드포인트로 Redis 락 비교 실행
5. 내부 benchmark scenario 엔드포인트로 TTS 비교 실행
6. 결과를 파일로 저장

`pnpm benchmark:tts` 의 기본 동작은 아래와 같습니다.

1. 서버를 `tts_fulltext_supabase`, `tts_chunked_supabase` 모드로 순차 기동
2. suite 시작 시 Redis/Supabase 캐시를 초기화
3. 같은 3개 경로를 `cold` phase로 1회 실행
4. reset 없이 같은 3개 경로를 `warm` phase로 다시 실행
5. 결과를 `benchmark-tts-results.json`, `benchmark-tts-summary.md`로 저장

포트를 바꿔 실행하려면:

```bash
BENCHMARK_PORT=3100 pnpm benchmark
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
BENCHMARK_MAP_ITERATIONS=2 BENCHMARK_LOCK_CONCURRENCY=2 pnpm benchmark
```

## 산출물

실행이 완료되면 루트에 아래 두 파일이 생성됩니다.

- `benchmark-results.json`
- `benchmark-summary.md`

TTS 전용 스크립트는 아래 두 파일을 생성합니다.

- `benchmark-tts-results.json`
- `benchmark-tts-summary.md`

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
- 따라서 벤치마크 스크립트는 일반 사용자 API 대신 내부 benchmark 엔드포인트만 호출합니다.

## 결과 해석 포인트

- 지도 조회는 `split`의 `map_only_latency_ms`가 `legacy` end-to-end보다 낮아야 합니다.
- Redis 락은 `with_lock`에서 `station_lock_skipped_total > 0` 이어야 하고, `seoul_realtime_fetch_started_total`이 `without_lock`보다 작아야 합니다.
- TTS는 cold/warm을 나눠서 해석해야 합니다.
- cold phase에서는 chunked가 chunk/merge 준비 비용 때문에 더 느릴 수 있습니다.
- warm phase에서는 `google_tts_synthesize_total`, `google_tts_synthesize_chars_total`, route latency가 cold보다 줄어드는지를 우선 봅니다.
