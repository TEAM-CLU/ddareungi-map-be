# TTS (Text-to-Speech)

`src/tts/`. Google Cloud TTS 로 합성한 mp3 를 **Supabase Storage** 의 `tts` 버킷에 보관, Redis 로 조회 캐시.

## 엔드포인트

### 외부 (`/tts/*`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/tts/test` | 임시 합성 (TTL 만료) |
| `POST` | `/tts/permanent` | 영구 보관 (자주 쓰는 안내 문구) |
| `GET` | `/tts/lookup` | 임시 mp3 URL 조회 |
| `GET` | `/tts/lookup-permanent` | 영구 mp3 URL 조회 |
| `GET` | `/tts/lookup-s3` | (이름은 s3, 실제는 Supabase Storage signed URL) |
| `GET` | `/tts/lookup-s3-permanent` | 위와 동일, permanent 디렉터리 |

### 내부 (`/internal/tts/*`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/internal/tts/metrics` | 캐시 히트율 / 합성 횟수 / 에러 등 모니터링 |

## Storage 레이아웃 (`tts` 버킷)

| 경로 prefix | 용도 | TTL |
|-------------|------|-----|
| `temporary/` | 한 번 쓰고 버릴 합성 | 30일 (`STORAGE_TTL_CHUNK_TEMPORARY_SECONDS`) |
| `chunk-temporary/` | 긴 텍스트 분할 청크 | 30일 |
| `merged/` | 청크 합친 결과 | 3일 (`STORAGE_TTL_MERGED_SECONDS`) |
| `permanent/` | 자주 쓰는 안내 (대여소 안내 등) | 영구 보존 |

## Redis 캐시

키 prefix: `tts:phrase:`

| TTL 변수 | 값 | 의미 |
|---------|-----|------|
| `REDIS_TTL` | 3일 | 일반 합성 |
| `REDIS_TTL_MERGED` | 1일 | 청크 머지 결과 |
| `REDIS_TTL_PERMANENT` | 10년 | 영구 |

## 합성 흐름 (TtsSynthesisService)

```
text → split into chunks (TtsTextChunkService)
     → for each chunk:
         hash → Redis 조회 (히트면 Storage URL 반환)
                → 미스: GCP TTS 호출 → mp3 → Storage upload → Redis set
     → 다중 청크면 ffmpeg 로 머지 → merged/ 업로드
     → 최종 URL 반환
```

## 서비스 책임

| 서비스 | 책임 |
|--------|------|
| `TtsSynthesisService` | GCP TTS 호출 + 캐시 관리 + 청크 머지 |
| `TtsStorageService` | Supabase Storage CRUD (signed URL 발급, public URL, 삭제) |
| `TtsCacheService` | Redis hash 키 + URL 매핑 |
| `TtsTextChunkService` | 긴 텍스트 안전 분할 (GCP TTS 한도 내) |
| `TtsStorageCleanupService` | 스케줄러로 만료된 임시 파일 정리 |

## 자격증명

- `GOOGLE_APPLICATION_CREDENTIALS=./ddareungimap-b829ea269d30.json` — GCP 서비스 계정 키 JSON
- 파일은 컨테이너 빌드 컨텍스트에 들어가지 않고, compose `volumes`로 read-only 바인드
- `SUPABASE_URL` + `SUPABASE_SECRET_KEY` — Storage 인증

## 자주 쓰는 안내 문구 패턴 (`tts.constants.ts`)

방향 안내 합성 시 텍스트 정규화에 사용:

```ts
ACTION_SUFFIXES = ['좌회전입니다', '우회전입니다', '직진입니다', '진행입니다', '유턴입니다']
DIRECTION_PREFIXES = ['좌측으로', '우측으로', '왼쪽으로', '오른쪽으로', '앞으로', '뒤로']
```

같은 의미 다른 표현(예: "좌측으로" vs "왼쪽으로")을 정규화해서 캐시 hit rate 올림.
