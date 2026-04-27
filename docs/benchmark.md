# 벤치마크

`scripts/benchmark/` 의 노드 스크립트가 dev 서버를 띄우고 부하를 가해 결과 JSON을 `benchmark-results/` 에 저장.

## 스크립트

| 명령 | 대상 |
|------|------|
| `pnpm run benchmark` / `benchmark:all` | 전체 (`run-all.mjs`) |
| `pnpm run benchmark:stations` | 대여소 조회 (`run-stations.mjs`) |
| `pnpm run benchmark:stations:clustered` | 대여소 클러스터링 (`run-stations-clustered.mjs`) |
| `pnpm run benchmark:tts` | TTS 합성 / 캐시 (`run-tts.mjs`) |

## 실행

```bash
pnpm install
pnpm run benchmark         # 모든 시나리오
```

벤치마크 실행 시 자체적으로 NestJS dev 서버를 spawn (BENCHMARK_PORT, 기본 3000). 외부 서비스(Supabase / GraphHopper / Redis)는 실제로 호출하므로 환경변수가 정상 세팅돼 있어야 함.

## 환경변수

| 키 | 기본값 | 용도 |
|----|--------|------|
| `BENCHMARK_PORT` | `3000` | 임시 dev 서버 포트 |
| `BENCHMARK_PROGRESS_INTERVAL_MS` | `10000` | 진행 로그 간격 |
| `BENCHMARK_OUTPUT_DIR` | `benchmark-results` | 결과 디렉터리 |
| `BENCHMARK_TIMESTAMP` | (자동) | 결과 파일명에 들어가는 타임스탬프 |
| `BENCHMARK_RELAY_SERVER_OUTPUT` | `true` | NestJS stdout/stderr 같이 출력 |

## 결과

`benchmark-results/<scenario>-<YYYYMMDD-HHMMSS>.json`
- `summary` (p50 / p95 / p99 / 처리량)
- `samples` (개별 요청 latency)

여러 회차를 비교하려면 두 JSON 을 diff 또는 별도 스프레드시트 도구로 해석.
