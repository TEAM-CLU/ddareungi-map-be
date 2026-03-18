# TTS Implementation

이 문서는 현재 코드 기준 TTS 전체 구현 흐름을 설명하는 기준 문서다. 설명 대상은 지금 실제로 동작하는 코드이며, 예전 설계나 성능 비교 해석은 포함하지 않는다.

기준 코드:

- [`../src/navigation/navigation.service.ts`](../src/navigation/navigation.service.ts)
- [`../src/navigation/services/navigation-helper.service.ts`](../src/navigation/services/navigation-helper.service.ts)
- [`../src/tts/tts.service.ts`](../src/tts/tts.service.ts)
- [`../src/tts/services/tts-text-chunk.service.ts`](../src/tts/services/tts-text-chunk.service.ts)
- [`../src/tts/services/tts-synthesis.service.ts`](../src/tts/services/tts-synthesis.service.ts)
- [`../src/tts/services/tts-storage.service.ts`](../src/tts/services/tts-storage.service.ts)
- [`../src/tts/services/tts-cache.service.ts`](../src/tts/services/tts-cache.service.ts)
- [`../src/tts/translation.service.ts`](../src/tts/translation.service.ts)
- [`../src/tts/tts.provider.ts`](../src/tts/tts.provider.ts)
- [`../src/tts/tts.controller.ts`](../src/tts/tts.controller.ts)

## 1. TTS가 호출되는 위치

TTS는 네비게이션 응답 생성 과정 안에서 직접 호출된다.

흐름:

1. [`NavigationService.startNavigationSession()`](../src/navigation/navigation.service.ts)가 경로와 instruction 목록을 준비한다.
2. [`NavigationHelperService.addTtsToInstructions()`](../src/navigation/services/navigation-helper.service.ts)가 instruction 텍스트를 모은다.
3. `addTtsToInstructions()`가 [`TtsService.batchSynthesize()`](../src/tts/tts.service.ts)를 호출한다.
4. 합성 결과 URL을 각 instruction에 `ttsUrl`로 붙여 최종 응답에 포함한다.

즉 TTS는 별도 백그라운드 작업이 아니라 네비게이션 응답 조립의 일부다.

## 2. TTS 서비스의 진입점

중앙 진입점은 [`TtsService`](../src/tts/tts.service.ts)다.

주요 메서드:

- `synthesizeAndCache()`
  - 임시 안내 문장 TTS 생성
- `synthesizeAndCacheOrThrow()`
  - controller나 상위 service에서 예외 흐름으로 사용할 때 호출
- `batchSynthesize()`
  - 여러 instruction 텍스트를 dedupe한 뒤 병렬 합성
- `batchSynthesizeForNavigation()`
  - 네비게이션용 배치 합성 진입점
- `synthesizePermanent()`
  - 고정 메시지 TTS 생성
- `synthesizePermanentOrThrow()`
  - 고정 메시지 TTS 예외 흐름용 래퍼
- `lookup()`, `lookupPermanent()`
  - Redis와 Storage 기준 캐시 조회
- `lookupS3()`, `lookupS3Permanent()`
  - Redis record와 Storage 객체 존재 여부를 함께 조회
- `listCached()`
  - Redis 기준 캐시 목록 조회

## 3. 합성 모드 결정

임시 문장 합성은 `TTS_SYNTHESIS_MODE` 값에 따라 두 모드 중 하나로 동작한다.

- `fulltext`
- `chunked`

[`TtsService`](../src/tts/tts.service.ts)는 constructor에서 `TTS_SYNTHESIS_MODE === 'chunked'`일 때만 chunked 모드를 사용하고, 나머지는 모두 `fulltext`로 처리한다.

고정 메시지 TTS는 이 분기와 무관하게 `permanent/` 경로를 사용하는 단일 흐름으로 처리된다.

## 4. 공통 전처리

임시 문장 합성은 두 모드 모두 먼저 같은 전처리를 거친다.

1. [`normalizeText()`](../src/tts/utils/normalize-text.ts)로 원문을 정규화한다.
2. [`TtsTextChunkService.normalizeTemporaryText()`](../src/tts/services/tts-text-chunk.service.ts)를 호출한다.
3. 영문이 포함되어 있으면 [`TranslationService.translateToKorean()`](../src/tts/translation.service.ts)로 한글 문장을 만든다.
4. 최종 공백과 특수문자를 정리해 캐시 기준 문자열을 만든다.

즉 실제 캐시와 합성의 기준은 원문이 아니라 정규화된 최종 한글 문장이다.

## 5. 캐시와 저장소 계층

### 5.1 Redis phrase cache

Redis 키 prefix는 [`tts.constants.ts`](../src/tts/tts.constants.ts)의 `tts:phrase:`다.

실제 접근은 [`TtsCacheService`](../src/tts/services/tts-cache.service.ts)가 담당한다.

저장되는 주요 값:

- `text`
- `textKo`
- `lang`
- `voice`
- `status`
- `storageKey`
- `ttsUrl`
- `hash`
- `createdAt`, `updatedAt`

TTL:

- 임시 TTS: `REDIS_TTL = 3일`
- 고정 메시지 TTS: `REDIS_TTL_PERMANENT = 10년`

### 5.2 Supabase Storage

현재 TTS는 Supabase Storage 버킷 `tts`를 사용한다.

경로 구조:

- `temporary/`
- `permanent/`
- `merged/`

의미:

- `temporary`: 임시 문장 전체 또는 가변 청크
- `permanent`: 반복 사용되는 고정 표현이나 고정 메시지
- `merged`: chunked 모드에서 최종 병합된 mp3

Storage 접근은 [`TtsStorageService`](../src/tts/services/tts-storage.service.ts)가 담당한다.

## 6. `fulltext` 모드 흐름

`fulltext`는 문장 전체를 한 번에 합성한다.

흐름:

1. `textKo` 기준으로 `hash = sha256(lang + voice + textKo)`를 만든다.
2. Redis record를 조회한다.
3. Redis hit이면 바로 URL을 반환한다.
4. Redis miss이면 `temporary/{lang}/{hash}.mp3` 존재 여부를 확인한다.
5. Storage hit이면 public URL을 반환하고 Redis record를 복원한다.
6. Storage miss이면 [`TtsSynthesisService.synthesizeSingleToStorage()`](../src/tts/services/tts-synthesis.service.ts)를 호출한다.
7. [`GoogleTtsProvider.synthesize()`](../src/tts/tts.provider.ts)로 mp3를 생성한다.
8. 결과를 Supabase Storage에 업로드하고 Redis record를 저장한다.

재사용 단위는 문장 전체다.

## 7. `chunked` 모드 흐름

`chunked`는 현재 아래 순서의 계층형 캐시 구조를 사용한다.

1. Redis phrase cache
2. merged storage
3. chunk storage

즉 현재 구조는 merged-first가 아니라 cache-first다.

흐름:

1. 정규화된 `textKo` 기준으로 `phraseHash = sha256(lang + voice + textKo)`를 만든다.
2. Redis `tts:phrase:{phraseHash}`를 조회한다.
3. Redis hit이면 최종 merged URL을 바로 반환한다.
4. Redis miss이면 [`TtsSynthesisService.synthesizeMerged()`](../src/tts/services/tts-synthesis.service.ts)를 호출한다.
5. `synthesizeMerged()`는 먼저 `merged/{lang}/{hash}.mp3` 존재 여부를 확인한다.
6. merged가 있으면 chunk 분해 없이 merged URL을 반환한다.
7. merged가 없을 때만 문장을 chunk로 분해한다.
8. 각 chunk를 병렬 처리한다.
9. 필요한 chunk만 Google TTS로 합성한다.
10. 준비된 chunk buffer를 `ffmpeg concat`으로 병합한다.
11. 병합 결과를 `merged/` 경로에 업로드한다.
12. 상위 `TtsService`가 최종 merged 메타데이터를 Redis에 저장한다.

## 8. 청크 분해 규칙

청크 분해는 [`TtsTextChunkService.splitNavigationText()`](../src/tts/services/tts-text-chunk.service.ts)에서 수행한다.

현재 규칙:

- 방향 접두어: `좌측으로`, `우측으로`, `왼쪽으로`, `오른쪽으로`, `앞으로`, `뒤로`
- 행동 접미어: `좌회전입니다`, `우회전입니다`, `직진입니다`, `진행입니다`, `유턴입니다`

예시:

`우측으로 공릉로51길로 우회전입니다`

분해 결과:

- `우측으로` → `permanent`
- `공릉로51길로` → `temporary`
- `우회전입니다` → `permanent`

방향/행동 토큰이 없으면 전체 문장을 `temporary` 하나로 처리한다.

## 9. chunk 합성과 병합

chunked 모드의 실제 합성은 [`TtsSynthesisService`](../src/tts/services/tts-synthesis.service.ts)가 담당한다.

### 9.1 chunk 처리

각 chunk에 대해:

1. `chunkHash = sha256(lang + voice + chunk.text)`를 만든다.
2. `cacheType`에 따라 storage path를 결정한다.
   - `permanent/{lang}/{hash}.mp3`
   - `temporary/{lang}/{hash}.mp3`
3. Storage hit이면 해당 파일을 다운로드해 재사용한다.
4. Storage miss이면 [`GoogleTtsProvider.synthesize()`](../src/tts/tts.provider.ts)를 호출한다.
5. 결과를 Supabase Storage에 업로드한다.

이 단계는 `Promise.all`로 병렬 처리된다.

### 9.2 merged 처리

merged 파일 키:

- `merged/{lang}/{hash}.mp3`

merged hash 기준:

- `sha256("merged:" + lang + voice + sourceText)`

chunk buffer가 준비되면:

1. 임시 디렉터리에 chunk mp3 파일을 쓴다.
2. `inputs.txt`를 생성한다.
3. `fluent-ffmpeg`로 concat merge를 수행한다.
4. 결과 `merged.mp3`를 읽어 Supabase Storage에 업로드한다.
5. 최종 merged URL을 반환한다.

chunk가 0개면 `InternalServerErrorException`을 던진다.

## 10. 고정 메시지 TTS 흐름

고정 메시지 TTS는 [`TtsService.synthesizePermanent()`](../src/tts/tts.service.ts)가 처리한다.

흐름:

1. 원문을 정규화한다.
2. `hash = sha256(lang + voice + normalized)`를 만든다.
3. Redis record를 조회한다.
4. Redis hit이면 URL을 반환한다.
5. Redis miss이면 `permanent/{lang}/{hash}.mp3` 존재 여부를 확인한다.
6. Storage hit이면 public URL을 반환하고 Redis record를 복원한다.
7. Storage miss이면 `synthesizeSingleToStorage()`를 호출해 새 mp3를 만든다.
8. Redis에 10년 TTL로 기록한다.

임시 문장과 달리 translation 단계는 없다.

## 11. Google Cloud TTS 호출

Google TTS 연동은 [`GoogleTtsProvider`](../src/tts/tts.provider.ts)가 담당한다.

특징:

- `GOOGLE_APPLICATION_CREDENTIALS` 파일 기반 인증
- 기본 언어는 `ko-KR`
- 기본 voice는 `ko-KR-Wavenet-A`
- `audioContent`가 없으면 `InternalServerErrorException`

즉 실제 mp3 생성은 provider 계층에서 수행되고, 상위 service는 캐시/스토리지/오케스트레이션을 담당한다.

## 12. 네비게이션 응답에 TTS가 붙는 방식

[`NavigationHelperService.addTtsToInstructions()`](../src/navigation/services/navigation-helper.service.ts)는 다음 순서로 동작한다.

1. instruction text를 dedupe해서 `batchSynthesize()`를 호출한다.
2. 각 instruction에 대해 합성 결과 URL을 찾아 `ttsUrl`로 넣는다.
3. 필요하면 번역된 한글 텍스트를 instruction `text`에 반영한다.
4. 다음 회전 좌표 등 네비게이션용 보조 정보도 함께 조립한다.

즉 클라이언트는 별도 TTS 생성 API를 먼저 호출하지 않아도, 네비게이션 세션 시작 응답에서 instruction별 `ttsUrl`을 바로 받을 수 있다.

## 13. TTS 전용 API

[`TtsController`](../src/tts/tts.controller.ts)는 운영 및 확인용 TTS API를 제공한다.

- `POST /tts/test`
  - 임시 문장 합성
- `POST /tts/permanent`
  - 고정 메시지 합성
- `GET /tts/lookup`
  - 특정 임시 문장 캐시 조회 또는 임시 캐시 목록 조회
- `GET /tts/lookup-permanent`
  - 특정 고정 메시지 캐시 조회 또는 고정 메시지 캐시 목록 조회
- `GET /tts/lookup-s3`
  - Redis hit 여부와 임시 또는 merged Storage 객체 존재 여부를 함께 조회
- `GET /tts/lookup-s3-permanent`
  - Redis hit 여부와 permanent Storage 객체 존재 여부를 함께 조회

이 controller는 직접 합성하지 않고 `TtsService` 메서드만 호출한다.
