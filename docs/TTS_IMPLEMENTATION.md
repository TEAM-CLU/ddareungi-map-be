# TTS Implementation

이 문서는 현재 코드 기준 TTS 구현과 캐시/스토리지/운영 메트릭 정책을 설명한다.

기준 코드:

- [`../src/tts/tts.service.ts`](../src/tts/tts.service.ts)
- [`../src/tts/services/tts-synthesis.service.ts`](../src/tts/services/tts-synthesis.service.ts)
- [`../src/tts/services/tts-storage.service.ts`](../src/tts/services/tts-storage.service.ts)
- [`../src/tts/services/tts-storage-cleanup.service.ts`](../src/tts/services/tts-storage-cleanup.service.ts)
- [`../src/tts/services/tts-cache.service.ts`](../src/tts/services/tts-cache.service.ts)
- [`../src/tts/services/tts-text-chunk.service.ts`](../src/tts/services/tts-text-chunk.service.ts)
- [`../src/tts/tts-metrics.service.ts`](../src/tts/tts-metrics.service.ts)
- [`../src/tts/internal-tts.controller.ts`](../src/tts/internal-tts.controller.ts)
- [`../src/navigation/services/navigation-helper.service.ts`](../src/navigation/services/navigation-helper.service.ts)

## 1. TTS 호출 위치

TTS는 네비게이션 응답 생성 과정에서 inline으로 실행된다.

1. `NavigationService.startNavigationSession()`이 경로와 instruction 목록을 준비한다.
2. `NavigationHelperService.addTtsToInstructions()`가 instruction 텍스트를 모은다.
3. `addTtsToInstructions()`가 `TtsService.batchSynthesize()`를 호출한다.
4. 합성 결과 URL을 각 instruction의 `ttsUrl`에 넣어 응답을 완성한다.

별도 큐나 백그라운드 워커는 없고, 응답 조립 중 캐시와 스토리지를 재사용한다.

## 2. 주요 진입점

중앙 서비스는 `TtsService`다.

- `synthesizeAndCache()`
  - 임시 안내 문장 TTS 생성
- `batchSynthesize()`
  - 여러 instruction 텍스트를 dedupe한 뒤 병렬 합성
- `synthesizePermanent()`
  - 고정 메시지 TTS 생성
- `lookup()`, `lookupPermanent()`
  - Redis와 Storage 기준 캐시 조회 및 Redis 복원
- `lookupS3()`, `lookupS3Permanent()`
  - Redis record와 Storage 객체 존재 여부 동시 조회
- `listCached()`
  - Redis 기준 캐시 목록 조회

운영 메트릭 조회는 별도 내부 컨트롤러 `GET /internal/tts/metrics`가 담당한다.

## 3. 합성 모드

임시 문장 합성은 `TTS_SYNTHESIS_MODE` 값에 따라 두 모드 중 하나로 동작한다.

- `fulltext`
- `chunked`

`chunked`일 때만 merged 결과와 chunk storage를 사용한다. 고정 메시지 TTS는 이 분기와 무관하게 `permanent/` 경로를 사용한다.

## 4. 공통 전처리

임시 문장 합성은 두 모드 모두 먼저 같은 전처리를 거친다.

1. `normalizeText()`로 원문을 정규화한다.
2. `TtsTextChunkService.normalizeTemporaryText()`를 호출한다.
3. 영문이 포함되면 `TranslationService.translateToKorean()`으로 한글 문장을 만든다.
4. 최종 공백과 특수문자를 정리해 캐시 기준 문자열을 만든다.

즉 실제 캐시 기준은 원문이 아니라 정규화된 최종 한글 문장이다.

## 5. 캐시와 저장소 정책

### 5.1 Redis phrase cache

Redis 키 prefix는 `tts:phrase:`다. 실제 저장/복원은 `TtsCacheService`가 담당한다.

저장 메타데이터:

- `text`
- `textKo`
- `lang`
- `voice`
- `status`
- `storageKey`
- `ttsUrl`
- `hash`
- `createdAt`, `updatedAt`

Redis TTL:

- fulltext temporary: 3일
- chunked merged result: 1일
- permanent message: 10년

`synthesizeAndCache()` 경로에서 Redis hit가 나면 TTL을 다시 연장한다. `lookup()` 계열은 Redis hit만으로 TTL을 연장하지 않고, Storage에서 복원할 때만 Redis를 다시 채운다.

### 5.2 Supabase Storage

버킷은 `tts`를 사용한다.

경로 구조:

- `temporary/`
  - fulltext 모드에서 문장 전체 mp3 저장
- `chunk-temporary/`
  - chunked 모드에서 가변 chunk mp3 저장
- `permanent/`
  - 고정 메시지와 재사용 가능한 permanent chunk 저장
- `merged/`
  - chunked 모드의 최종 병합 mp3 저장

Storage TTL은 앱 내부 cleanup cron으로 관리한다.

- `merged/`: 3일 보관
- `chunk-temporary/`: 30일 보관
- `temporary/`: 이번 정책 변경에서는 기존 동작 유지
- `permanent/`: 삭제 대상 아님

만료 기준은 access sliding이 아니라 `updated_at ?? created_at` 기준 absolute retention이다.

## 6. `fulltext` 모드 흐름

`fulltext`는 문장 전체를 한 번에 합성한다.

1. `textKo` 기준으로 `hash = sha256(lang + voice + textKo)`를 만든다.
2. Redis record를 조회한다.
3. Redis hit이면 URL을 반환하고 TTL을 3일로 갱신한다.
4. Redis miss이면 `temporary/{lang}/{hash}.mp3` 존재 여부를 확인한다.
5. Storage hit이면 public URL을 반환하고 Redis record를 3일 TTL로 복원한다.
6. Storage miss이면 `TtsSynthesisService.synthesizeSingleToStorage()`를 호출한다.
7. Google TTS로 mp3를 생성하고 Storage에 업로드한다.
8. 결과를 Redis에 3일 TTL로 저장한다.

재사용 단위는 문장 전체다.

## 7. `chunked` 모드 흐름

`chunked`는 다음 계층형 캐시 구조를 사용한다.

1. Redis phrase cache
2. merged storage
3. chunk storage

흐름:

1. 정규화된 `textKo` 기준으로 `phraseHash = sha256(lang + voice + textKo)`를 만든다.
2. merged request 메트릭용으로 `mergedHash = sha256("merged:" + lang + voice + textKo)`를 계산한다.
3. `TtsMetricsService.recordMergedRequest()`가 전체 요청 수와 재요청 여부를 집계한다.
4. Redis `tts:phrase:{phraseHash}`를 조회한다.
5. Redis hit이면 최종 merged URL을 반환하고 TTL을 1일로 갱신한다.
6. Redis miss이면 `TtsSynthesisService.synthesizeMerged()`를 호출한다.
7. `synthesizeMerged()`는 먼저 `merged/{lang}/{mergedHash}.mp3` 존재 여부를 확인한다.
8. merged가 있으면 chunk 분해 없이 merged URL을 반환한다.
9. merged가 없을 때만 문장을 chunk로 분해한다.
10. 각 chunk를 병렬 처리한다.
11. 필요한 chunk만 Google TTS로 합성한다.
12. 준비된 chunk buffer를 `ffmpeg concat`으로 병합한다.
13. 병합 결과를 `merged/` 경로에 업로드한다.
14. 상위 `TtsService`가 최종 merged 메타데이터를 Redis에 1일 TTL로 저장한다.

즉 chunked 모드에서 Redis는 merged 결과에 대한 짧은 인덱스 역할을 하고, 실파일 재사용은 merged/chunk storage가 담당한다.

## 8. chunk 분해 규칙

chunk 분해는 `TtsTextChunkService.splitNavigationText()`가 담당한다.

현재 규칙:

- 방향 접두어: `좌측으로`, `우측으로`, `왼쪽으로`, `오른쪽으로`, `앞으로`, `뒤로`
- 행동 접미어: `좌회전입니다`, `우회전입니다`, `직진입니다`, `진행입니다`, `유턴입니다`

분해 결과의 cache type:

- 방향/행동처럼 반복 가능한 표현: `permanent`
- 문장 중 가변 구간: `temporary`

chunked 모드에서 `temporary` chunk는 `chunk-temporary/`에, `permanent` chunk는 `permanent/`에 저장한다.

## 9. chunk 합성과 병합

`TtsSynthesisService`가 chunk 합성과 병합을 담당한다.

### 9.1 chunk 처리

각 chunk에 대해:

1. `chunkHash = sha256(lang + voice + chunk.text)`를 만든다.
2. `cacheType`에 따라 storage path를 결정한다.
   - `permanent/{lang}/{hash}.mp3`
   - `chunk-temporary/{lang}/{hash}.mp3`
3. Storage hit이면 해당 파일을 다운로드해 buffer를 재사용한다.
4. Storage miss이면 Google TTS를 호출한다.
5. 합성한 chunk를 Storage에 업로드한다.

### 9.2 merged 처리

merged 파일 키:

- `merged/{lang}/{hash}.mp3`

merged hash 기준:

- `sha256("merged:" + lang + voice + sourceText)`

chunk buffer가 준비되면:

1. 임시 디렉터리에 chunk mp3 파일을 쓴다.
2. `inputs.txt`를 생성한다.
3. `fluent-ffmpeg`로 concat merge를 수행한다.
4. 결과 `merged.mp3`를 읽어 Storage에 업로드한다.
5. 최종 merged URL을 반환한다.

## 10. 고정 메시지 TTS

고정 메시지 TTS는 `TtsService.synthesizePermanent()`가 처리한다.

1. 원문을 정규화한다.
2. `hash = sha256(lang + voice + normalized)`를 만든다.
3. Redis record를 조회한다.
4. Redis hit이면 URL을 반환하고 TTL을 10년으로 갱신한다.
5. Redis miss이면 `permanent/{lang}/{hash}.mp3` 존재 여부를 확인한다.
6. Storage hit이면 public URL을 반환하고 Redis record를 10년 TTL로 복원한다.
7. Storage miss이면 새 mp3를 생성하고 Redis에 저장한다.

임시 문장과 달리 translation 단계는 없다.

## 11. Storage cleanup cron

`TtsStorageCleanupService`가 매시간 `@Cron('0 * * * *')`로 정리 작업을 수행한다.

정리 대상:

- `merged/` 아래 파일 중 3일 초과 파일
- `chunk-temporary/` 아래 파일 중 30일 초과 파일

정리 방식:

- Supabase Storage를 prefix별로 재귀 순회한다.
- 만료 파일을 100개 단위로 `remove()` 호출한다.
- 일부 배치 삭제가 실패해도 전체 작업을 중단하지 않고 로그만 남기고 다음 배치를 계속 처리한다.

`permanent/`와 fulltext용 `temporary/`는 이 cron의 삭제 대상이 아니다.

## 12. 운영 메트릭

always-on 운영 메트릭은 `TtsMetricsService`가 담당한다. 이 서비스는 benchmark 토글과 무관하게 항상 켜져 있고, 프로세스 lifetime 동안 누적 집계한다.

노출 카운터:

- `tts_chunk_synthesized_total`
- `tts_merged_created_total`
- `tts_merged_cache_hit_total`
- `tts_merged_request_total`
- `tts_merged_repeat_request_total`

노출 비율:

- `tts_merged_repeat_request_ratio`

정의:

- `tts_chunk_synthesized_total`
  - temporary/permanent chunk를 실제 합성한 횟수
- `tts_merged_created_total`
  - merged mp3를 실제 생성한 횟수
- `tts_merged_cache_hit_total`
  - merged 파일이 Storage에서 바로 재사용된 횟수
- `tts_merged_request_total`
  - chunked 모드에서 최종 merged 결과를 요청한 전체 횟수
- `tts_merged_repeat_request_total`
  - 이미 한 번 이상 본 merged hash를 다시 요청한 횟수
- `tts_merged_repeat_request_ratio`
  - `repeat_request_total / merged_request_total`

재요청 여부는 `TtsMetricsService` 내부 `Set`으로 판정한다. lookup 전용 admin 조회는 이 요청 수에 포함하지 않는다.

## 13. 운영 메트릭 조회 API

내부 운영 API:

- `GET /internal/tts/metrics`

특징:

- `@AdminProtected()` 적용
- admin rate limit 적용
- 응답은 `counters`와 `ratios` 두 블록으로 구성

이 API는 benchmark snapshot과 별개이며, 운영 중 TTS 캐시 효율과 재요청 패턴을 확인하는 용도다.
