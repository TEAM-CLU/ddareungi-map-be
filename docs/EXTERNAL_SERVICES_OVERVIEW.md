# 외부 서비스 통합 개요

이 문서는 현재 코드가 실제로 의존하는 외부 서비스만 정리한다.

## 1. Supabase

### 역할

- PostgreSQL / PostGIS 데이터베이스
- TTS 오디오 파일 저장용 Supabase Storage

### 연결 도메인

- `common`
- `tts`
- `stations` (DB)
- 기타 TypeORM 기반 전 도메인

### 관련 코드

- [`../src/common/supabase/supabase.module.ts`](../src/common/supabase/supabase.module.ts)
- [`../src/tts/services/tts-storage.service.ts`](../src/tts/services/tts-storage.service.ts)
- [`../src/app.module.ts`](../src/app.module.ts)

### 현재 사용 방식

- 서버는 `SUPABASE_URL` 과 서버 키를 사용해 Supabase client 를 생성한다.
- TTS 는 `tts` 버킷의 `temporary`, `permanent`, `merged` 경로를 사용한다.
- 위치 기반 대여소 조회는 PostgreSQL + PostGIS 위에서 TypeORM / raw spatial query 를 함께 사용한다.

## 2. Redis

### 역할

- 네비게이션 세션 저장
- route cache 저장
- TTS phrase cache 저장
- 일부 운영/벤치마크 계측 보조

### 연결 도메인

- `navigation`
- `routes`
- `tts`
- `auth` 일부 검증 흐름

### 관련 코드

- [`../src/app.module.ts`](../src/app.module.ts)
- [`../src/navigation/services/navigation-session.service.ts`](../src/navigation/services/navigation-session.service.ts)
- [`../src/navigation/services/navigation-helper.service.ts`](../src/navigation/services/navigation-helper.service.ts)
- [`../src/routes/services/route-optimizer.service.ts`](../src/routes/services/route-optimizer.service.ts)
- [`../src/tts/services/tts-cache.service.ts`](../src/tts/services/tts-cache.service.ts)

### 현재 사용 방식

- 네비게이션 세션 키와 route 키를 분리해 TTL 기반으로 관리한다.
- TTS 는 `tts:phrase:` prefix 를 사용해 phrase cache 를 저장한다.
- 운영 환경 기준 로컬 Redis 와 연결되는 구조를 전제로 한다.

## 3. Seoul Open API

### 역할

- 따릉이 대여소 목록 조회
- 대여소 실시간 자전거 현황 조회

### 연결 도메인

- `stations`

### 관련 코드

- [`../src/stations/services/seoul-api.service.ts`](../src/stations/services/seoul-api.service.ts)
- [`../src/stations/services/station-sync.service.ts`](../src/stations/services/station-sync.service.ts)
- [`../src/stations/services/station-realtime.service.ts`](../src/stations/services/station-realtime.service.ts)

### 현재 사용 방식

- `SeoulApiService` 가 대여소 기본 정보 API 와 실시간 정보 API 를 모두 호출한다.
- station sync / realtime sync / benchmark 시나리오에서 이 서비스를 재사용한다.

## 4. GraphHopper

### 역할

- 자전거/도보 경로 계산
- 대안 경로, 원형 경로, 다중 프로필 경로 계산

### 연결 도메인

- `routes`
- `navigation`

### 관련 코드

- [`../src/routes/services/graphhopper.service.ts`](../src/routes/services/graphhopper.service.ts)
- [`../src/routes/services/route-optimizer.service.ts`](../src/routes/services/route-optimizer.service.ts)

### 현재 사용 방식

- Nest 서버는 외부 GraphHopper 서버의 `/route` endpoint 를 호출한다.
- `safe_bike`, `fast_bike` 중심으로 경로를 계산하고, instruction 포함 여부를 옵션으로 제어한다.

## 5. Google Cloud TTS

### 역할

- 네비게이션 instruction 텍스트를 MP3 오디오로 합성

### 연결 도메인

- `tts`
- `navigation`

### 관련 코드

- [`../src/tts/tts.provider.ts`](../src/tts/tts.provider.ts)
- [`../src/tts/services/tts-synthesis.service.ts`](../src/tts/services/tts-synthesis.service.ts)
- [`../src/navigation/services/navigation-helper.service.ts`](../src/navigation/services/navigation-helper.service.ts)

### 현재 사용 방식

- `GoogleTtsProvider` 가 서비스 계정 키 파일을 사용해 `TextToSpeechClient` 를 초기화한다.
- `fulltext` 와 `chunked` 모드 모두 실제 음성 합성은 이 provider 를 통해 수행한다.

## 6. Google OAuth / Google People API

### 역할

- Google 소셜 로그인
- Google People API 를 통한 추가 사용자 정보 조회

### 연결 도메인

- `auth`

### 관련 코드

- [`../src/auth/strategies/google.strategy.ts`](../src/auth/strategies/google.strategy.ts)
- [`../src/auth/auth.service.ts`](../src/auth/auth.service.ts)

### 현재 사용 방식

- 기본 로그인은 Google OAuth strategy 로 처리한다.
- strategy 내부에서 People API 를 추가 호출해 성별/생년 정보 같은 선택 데이터를 보강한다.
- PKCE 기반 Google 로그인 흐름도 `AuthService` 에 구현되어 있다.

## 7. Kakao OAuth

### 역할

- Kakao 소셜 로그인

### 연결 도메인

- `auth`

### 관련 코드

- [`../src/auth/strategies/kakao.strategy.ts`](../src/auth/strategies/kakao.strategy.ts)
- [`../src/auth/auth.service.ts`](../src/auth/auth.service.ts)

### 현재 사용 방식

- Passport Kakao strategy 를 사용한다.
- strategy 단계에서 Kakao 사용자 정보 API 를 다시 호출해 프로필을 읽고, 최종 계정 처리는 `AuthService` 로 넘긴다.
- PKCE 기반 Kakao 로그인도 별도로 지원한다.

## 8. Naver OAuth

### 역할

- Naver 소셜 로그인

### 연결 도메인

- `auth`

### 관련 코드

- [`../src/auth/strategies/naver.strategy.ts`](../src/auth/strategies/naver.strategy.ts)
- [`../src/auth/auth.service.ts`](../src/auth/auth.service.ts)

### 현재 사용 방식

- Passport Naver strategy 를 사용한다.
- strategy 에서 Naver 사용자 정보 API 를 호출하고, 결과를 `AuthService` 로 넘긴다.
- PKCE 기반 Naver 로그인도 별도로 구현되어 있다.

## 9. Kakao Map JavaScript API

### 역할

- `/map` 페이지에 지도 렌더링용 Kakao Map SDK 제공

### 연결 도메인

- `map`

### 관련 코드

- [`../src/map/map.controller.ts`](../src/map/map.controller.ts)

### 현재 사용 방식

- `MapController` 가 `public/map.html` 템플릿을 읽고, `KAKAO_MAP_API` 값을 주입해 최종 HTML 을 반환한다.
- 프런트엔드 스크립트도 정적으로 링크하지 않고 인라인으로 주입한다.

## 10. Gmail SMTP (Nodemailer)

### 역할

- 이메일 인증 코드 발송
- 일반 알림 이메일 발송

### 연결 도메인

- `mail`
- `auth`

### 관련 코드

- [`../src/mail/mail.service.ts`](../src/mail/mail.service.ts)
- [`../src/auth/auth.service.ts`](../src/auth/auth.service.ts)

### 현재 사용 방식

- `MailService` 가 Nodemailer transport 를 만들고 Gmail SMTP 로 메일을 발송한다.
- 이메일 인증 코드는 `AuthService` 에서 생성하고, 실제 발송은 `MailService` 가 담당한다.

## 11. Google Analytics 4 (Measurement Protocol)

### 역할

- station search / route search / navigation 사용 행동 추적
- 핵심 API의 성공/실패/응답 시간 추적

### 연결 도메인

- `analytics`
- `stations`
- `routes`
- `navigation`

### 관련 코드

- [`../src/analytics/analytics.module.ts`](../src/analytics/analytics.module.ts)
- [`../src/analytics/analytics.service.ts`](../src/analytics/analytics.service.ts)
- [`../src/analytics/ga4-measurement-protocol.client.ts`](../src/analytics/ga4-measurement-protocol.client.ts)
- [`../src/analytics/analytics-identity.resolver.ts`](../src/analytics/analytics-identity.resolver.ts)

### 현재 사용 방식

- 백엔드가 `https://www.google-analytics.com/mp/collect`로 직접 이벤트를 전송한다.
- `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`가 모두 있을 때만 활성화된다.
- `X-GA-Client-Id` 또는 `X-Anonymous-App-Id`를 기준으로 `client_id`를 구성한다.
- `Authorization` 헤더가 있으면 optional JWT decode로 `user_id`를 보강한다.
- analytics 전송 실패는 warning만 남기고 비즈니스 API 흐름은 그대로 유지한다.

상세 이벤트 스키마와 동작 원리는 [`./GA4_ANALYTICS_IMPLEMENTATION.md`](./GA4_ANALYTICS_IMPLEMENTATION.md)를 참고한다.

## 참고 문서

- [GRAPHHOPPER_SETUP.md](./GRAPHHOPPER_SETUP.md)
- [REDIS_SETUP.md](./REDIS_SETUP.md)
- [TTS_IMPLEMENTATION.md](./TTS_IMPLEMENTATION.md)
- [ENVIRONMENT_GUIDE.md](./ENVIRONMENT_GUIDE.md)
