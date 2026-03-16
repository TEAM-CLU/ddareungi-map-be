# Chunk-Based TTS Architecture

현재 TTS는 `fulltext`와 `chunked` 두 가지 합성 전략을 지원한다. 이 문서는 그중 `chunked` 모드가 실제 코드에서 어떻게 동작하는지 설명한다.

기준 코드:

- `src/tts/tts.service.ts`
- `src/tts/services/tts-text-chunk.service.ts`
- `src/tts/services/tts-synthesis.service.ts`
- `src/tts/services/tts-storage.service.ts`
- `src/tts/services/tts-cache.service.ts`

## 1. 목적

기존 문장 전체 합성 방식은 안내 문장이 조금만 달라져도 Google TTS를 다시 호출해야 했다.

예:

- `우측으로 공릉로51길로 우회전입니다`
- `우측으로 공릉로27길로 우회전입니다`

두 문장은 앞뒤 표현이 비슷하지만, 전체 문장을 하나의 캐시 단위로 보면 재사용이 거의 일어나지 않는다.

이를 개선하기 위해 현재 구조는 안내 문장을 재사용 가능한 청크로 나눈다.

## 2. 핵심 아이디어

안내 문장을 아래 3종류로 본다.

1. 방향 접두어
2. 가변 구간
3. 행동 접미어

예:

`우측으로 공릉로51길로 우회전입니다`

분해 결과:

- `우측으로` -> permanent
- `공릉로51길로` -> temporary
- `우회전입니다` -> permanent

이렇게 하면 자주 반복되는 고정 표현은 한 번 만든 MP3를 계속 재사용하고, 자주 바뀌는 중간 구간만 새로 합성하면 된다.

## 3. 전체 흐름

`TTS_SYNTHESIS_MODE=chunked` 일 때 `TtsService.synthesizeAndCache()`는 아래 순서로 동작한다.

1. 입력 문장을 정규화한다.
2. 영문이 포함되어 있으면 한글 안내 문장으로 변환한다.
3. 최종 한글 문장 전체 기준으로 `phraseHash`를 만든다.
4. Redis `tts:phrase:{hash}` 에서 최종 merged 결과 메타데이터를 먼저 조회한다.
5. Redis hit이면 즉시 URL을 반환한다.
6. Redis miss이면 `TtsSynthesisService.synthesizeMerged()`를 호출한다.
7. `synthesizeMerged()`는 먼저 `merged/{lang}/{hash}.mp3` 존재 여부를 확인한다.
8. merged 파일이 이미 있으면 청크 분해 없이 merged URL을 바로 반환한다.
9. merged 파일이 없을 때만 문장을 청크로 분해한다.
10. 각 청크에 대해 Supabase Storage에서 MP3가 있는지 확인한다.
11. 있으면 다운로드해서 재사용한다.
12. 없으면 Google TTS로 해당 청크만 합성하고 Supabase Storage에 업로드한다.
13. 확보한 청크 MP3들을 `ffmpeg concat`으로 병합한다.
14. 병합 결과를 `merged/...` 경로에 다시 저장한다.
15. 최종 merged 결과를 Redis에 기록한다.
16. 최종 merged URL을 응답으로 반환한다.

즉, 현재 구조는 아래처럼 계층형 캐시로 동작한다.

- 1차 캐시: Redis의 최종 문장 메타데이터
- 2차 캐시: Supabase Storage의 merged MP3
- 3차 캐시: Supabase Storage의 chunk MP3

## 4. 텍스트 정규화와 한글 변환

청크 분해 전에 `TtsTextChunkService.normalizeTemporaryText()`가 먼저 실행된다.

이 단계에서 수행하는 일:

- 공백 정리
- 특수문자 정리
- 영문 포함 시 `TranslationService`를 통한 한글 안내 문장 변환
- 최종 텍스트 재정규화

따라서 청크 분해 기준은 원문이 아니라 "정규화된 최종 한글 문장"이다.

## 5. 청크 분해 규칙

청크 분해는 `TtsTextChunkService.splitNavigationText()`에서 수행한다.

현재 규칙은 단순하다.

### 5.1 행동 접미어 추출

문장 끝이 아래 상수 중 하나로 끝나는지 검사한다.

- `좌회전입니다`
- `우회전입니다`
- `직진입니다`
- `진행입니다`
- `유턴입니다`

끝부분이 일치하면 그 부분을 `permanent` 청크로 분리한다.

### 5.2 방향 접두어 추출

문장 앞부분이 아래 상수 중 하나로 시작하는지 검사한다.

- `좌측으로`
- `우측으로`
- `왼쪽으로`
- `오른쪽으로`
- `앞으로`
- `뒤로`

앞부분이 일치하면 그 부분을 `permanent` 청크로 분리한다.

### 5.3 남은 본문 처리

앞/뒤 고정 표현을 떼고 남은 본문은 `temporary` 청크로 저장한다.

따라서 현재 구현은 "음절 단위 분리"가 아니라, 네비게이션 문장을 의미 단위로 나누는 방식이다.

## 6. 청크별 MP3 생성

각 청크는 `TtsSynthesisService.getChunkBuffer()`에서 처리된다.

청크 단위 해시는 아래 기준으로 생성한다.

- `sha256(lang + voice + chunk.text)`

청크 저장 경로는 cache type에 따라 달라진다.

- `permanent/{lang}/{hash}.mp3`
- `temporary/{lang}/{hash}.mp3`

동작 순서:

1. 청크 해시 생성
2. storage key 생성
3. Supabase Storage 존재 여부 확인
4. 있으면 다운로드
5. 없으면 Google TTS 합성 후 업로드

이 단계에서 `permanent` 청크는 여러 안내 문장에서 반복 재사용된다.

## 7. merged 우선 확인과 병합 생성

청크별 MP3가 준비되면 `TtsSynthesisService.synthesizeMerged()`가 병합을 수행한다.

현재 순서는 아래와 같다.

1. 먼저 `mergedHash`와 `mergedKey`를 계산한다.
2. `merged/{lang}/{hash}.mp3`가 이미 있으면 즉시 반환한다.
3. merged가 없을 때만 청크를 분해한다.
4. 각 청크는 `Promise.all`로 병렬 처리한다.
5. 모든 청크 buffer가 준비되면 merge를 수행한다.
6. 생성된 merged buffer를 Supabase에 업로드한다.

실제 병합 방식:

1. 각 청크 buffer를 임시 디렉터리에 파일로 저장
2. `inputs.txt` concat 목록 생성
3. `fluent-ffmpeg`로 `ffmpeg -f concat` 실행
4. 최종 `merged.mp3` 생성
5. 생성된 merged buffer를 읽어서 Supabase에 업로드
6. 임시 디렉터리 정리

merged 파일 경로:

- `merged/{lang}/{hash}.mp3`

merged 해시는 아래 기준으로 생성한다.

- `sha256("merged:" + lang + voice + sourceText)`

즉 청크를 다시 조합한 최종 문장 자체도 스토리지에 저장된다.

## 8. Redis 캐시 구조

Redis 키 prefix는 아래와 같다.

- `tts:phrase:{hash}`

여기서 hash는 "최종 문장" 기준이다. 즉 Redis는 청크를 저장하지 않고, 최종 merged 결과를 다시 찾기 위한 상위 캐시 역할을 한다.

chunked 모드에서 Redis는 청크별 MP3를 저장하지 않는다. Redis에는 최종 응답에 필요한 메타데이터만 저장한다.

예:

- 원문
- 한글 문장
- lang
- voice
- merged storage key
- merged public URL
- 상태값

temporary TTL:

- `REDIS_TTL = 3일`

permanent TTL:

- `REDIS_TTL_PERMANENT = 10년`

## 9. Supabase Storage 구조

현재 TTS 버킷은 `tts` 이다.

하위 경로는 아래 3가지로 구분한다.

- `temporary/`
- `permanent/`
- `merged/`

의미는 다음과 같다.

- `temporary`: 문장마다 자주 바뀌는 가변 청크
- `permanent`: 자주 반복되는 고정 청크
- `merged`: 최종 병합 결과

## 10. fulltext 모드와의 차이

### fulltext

- 문장 전체를 한 번에 합성
- Redis miss 후 Storage miss면 바로 Google TTS 1회 호출
- 재사용 단위가 문장 전체

### chunked

- 문장을 여러 청크로 분해
- 청크별 MP3를 먼저 재사용
- 필요한 청크만 새로 합성
- 마지막에 merged 파일 생성

따라서 유사 문장이 많을수록 `chunked`의 이점이 커진다.

## 11. 예시 시나리오

아래 두 문장이 순서대로 요청된다고 가정한다.

1. `우측으로 공릉로51길로 우회전입니다`
2. `우측으로 공릉로27길로 우회전입니다`

첫 번째 요청:

- Redis miss
- merged miss
- `우측으로` 합성 후 저장
- `공릉로51길로` 합성 후 저장
- `우회전입니다` 합성 후 저장
- merged 생성 후 저장
- Redis record 저장

두 번째 요청:

같은 문장이 다시 들어오면:

- Redis hit
- 즉시 반환

유사하지만 다른 문장이 들어오면:

- Redis miss
- merged miss
- `우측으로` -> 재사용
- `공릉로27길로` -> 새로 합성
- `우회전입니다` -> 재사용
- merged 생성 후 저장
- Redis record 저장

즉 현재 구조는 "최종 문장 재사용이 가능하면 그걸 먼저 쓰고, 그게 안 되면 청크 재사용으로 내려간다"가 핵심이다.

## 12. 현재 구현의 한계

현재 분해 규칙은 상수 기반이라 단순한 편이다.

한계:

- 행동 접미어 목록에 없는 문장은 세밀하게 분해되지 않을 수 있음
- 방향 접두어 목록에 없는 표현은 고정 청크로 분리되지 않음
- 본문 전체를 하나의 temporary 청크로 취급하므로, 더 세밀한 도로명/숫자 단위 재사용은 아직 없음

즉 현재 구조는 "의미 기반 3분할"에 가깝고, 더 미세한 재사용 전략으로 확장할 여지는 있다.

## 13. 관련 환경 변수

- `TTS_SYNTHESIS_MODE=chunked`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `ffmpeg` 실행 가능 경로

## 14. 요약

현재 chunk-based TTS는 아래 전략으로 요약할 수 있다.

1. 문장을 정규화하고 한글로 변환한다.
2. 방향/본문/행동 단위로 분해한다.
3. 고정 표현은 `permanent`, 가변 표현은 `temporary`로 나눈다.
4. 각 청크를 Supabase Storage에서 우선 재사용한다.
5. 부족한 청크만 Google TTS로 합성한다.
6. 최종 결과는 `merged` 파일로 저장한다.
7. 최종 merged URL은 Redis에 캐시한다.

결과적으로 유사 안내 문장이 반복될수록 TTS 호출 수와 합성 비용을 줄일 수 있다.
