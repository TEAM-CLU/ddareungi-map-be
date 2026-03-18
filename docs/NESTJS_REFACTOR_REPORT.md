# NestJS Refactor Report

## 프로젝트 현재 상태 요약

이 프로젝트는 도메인 중심 모듈 구조 위에 인증, 대여소 조회, 네비게이션, TTS, 외부 API 연동을 얹은 NestJS 애플리케이션이다. 최근 리팩토링의 핵심은 `nestjs-best-practices`의 주요 규칙을 실제 코드에 맞게 정리해, controller 를 얇게 만들고 예외 처리, 보안, 로깅, 설정 책임을 공통 계층으로 모으는 것이었다.

핵심 원칙은 아래와 같다.

- controller 는 요청 수신, DTO 바인딩, Guard 적용, 성공 응답 반환에 집중한다.
- 예외는 service 또는 공통 인프라에서 던지고, 전역 필터가 `ErrorResponseDto`로 정규화한다.
- 인증/운영 보호는 Guard 와 middleware 로 처리한다.
- 입력 검증은 DTO 와 ValidationPipe, 도메인 전용 validation service 로 나눈다.
- 운영 환경 설정과 로깅 정책은 bootstrap / config 계층에서 통합 관리한다.

## `nestjs-best-practices` 핵심 요약과 실제 반영 사례

### 1. `arch-single-responsibility`

큰 controller 나 service 가 여러 책임을 동시에 가지지 않도록, 조회 조합과 검증을 전용 service 로 분리하는 규칙이다.

실제 반영 사례:

- [`../src/stations/services/station-request-validation.service.ts`](../src/stations/services/station-request-validation.service.ts)
  - 위도/경도/반경 검증 전담
- [`../src/stations/services/station-read-facade.service.ts`](../src/stations/services/station-read-facade.service.ts)
  - `nearby`, `map-area`, `findOne` 조회 orchestration 전담
- [`../src/stations/stations.controller.ts`](../src/stations/stations.controller.ts)
  - 직접 좌표 검증이나 query/service 조합을 하지 않고 facade 를 호출

예시:

- `StationsController.getStationsWithinRadius()`는 좌표/반경 검증을 `StationRequestValidationService`로 넘기고, 실제 조회/응답 분기 로직은 `StationReadFacadeService`에 위임한다.

### 2. `error-use-exception-filters`

controller 에서 에러 응답을 직접 조립하지 않고, 공통 예외 필터에서 일관된 응답 형식을 만드는 규칙이다.

실제 반영 사례:

- [`../src/common/filters/api-exception.filter.ts`](../src/common/filters/api-exception.filter.ts)
- [`../src/main.ts`](../src/main.ts)

예시:

- `main.ts`에서 `app.useGlobalFilters(new ApiExceptionFilter())`를 등록해 `HttpException`과 일반 예외를 모두 `ErrorResponseDto` 구조로 통일한다.

### 3. `error-throw-http-exceptions`

service 계층에서 의미 있는 Nest 예외를 던지고, controller 는 그 예외를 다시 감싸지 않는 규칙이다.

실제 반영 사례:

- [`../src/routes/services/graphhopper.service.ts`](../src/routes/services/graphhopper.service.ts)
  - 경로 없음은 `BadRequestException`
  - 외부 엔진 호출 실패는 `InternalServerErrorException`
- [`../src/navigation/services/navigation-session.service.ts`](../src/navigation/services/navigation-session.service.ts)
  - 세션/경로 미존재는 `NotFoundException`
- [`../src/tts/services/tts-storage.service.ts`](../src/tts/services/tts-storage.service.ts)
  - 스토리지 업로드/다운로드 실패는 `InternalServerErrorException`

예시:

- `GraphHopperService.getSingleRoute()`는 경로가 없으면 `BadRequestException`을 던지고, controller 는 그 예외를 그대로 글로벌 필터 흐름에 태운다.

### 4. `security-validate-all-input`

모든 입력을 DTO 또는 전용 validation service 로 검증하는 규칙이다.

실제 반영 사례:

- [`../src/main.ts`](../src/main.ts)
  - 전역 `ValidationPipe` 사용
- [`../src/auth/dto/exchange-token.dto.ts`](../src/auth/dto/exchange-token.dto.ts)
  - `/auth/exchange-token` 검증
- [`../src/stations/services/station-request-validation.service.ts`](../src/stations/services/station-request-validation.service.ts)
  - query param 좌표/반경 검증

예시:

- `/auth/exchange-token`은 controller 가 문자열 존재 여부를 직접 검사하지 않고 `ExchangeTokenDto` + ValidationPipe 를 사용한다.

### 5. `security-use-guards`

인증/운영 보호는 controller 로직이 아니라 Guard 로 처리하는 규칙이다.

실제 반영 사례:

- [`../src/common/guards/admin-basic-auth.guard.ts`](../src/common/guards/admin-basic-auth.guard.ts)
- [`../src/common/decorators/admin-protected.decorator.ts`](../src/common/decorators/admin-protected.decorator.ts)
- [`../src/user/guards/jwt-auth.guard.ts`](../src/user/guards/jwt-auth.guard.ts)
- [`../src/user/guards/withdraw-by-email.guard.ts`](../src/user/guards/withdraw-by-email.guard.ts)

예시:

- `/internal/benchmark/*`, `/auth/debug/states`, 대여소 수동 동기화/삭제 API 는 `@AdminProtected()` 로 Basic Auth Guard 를 적용한다.

### 6. `security-rate-limiting`

전역 throttling 과 민감 endpoint override 를 통해 운영성 있는 IP 기반 제한을 적용하는 규칙이다.

실제 반영 사례:

- [`../src/app.module.ts`](../src/app.module.ts)
  - `ThrottlerModule` 전역 등록
- [`../src/common/rate-limit/rate-limit.util.ts`](../src/common/rate-limit/rate-limit.util.ts)
  - 기본값, skip 대상, tracker 정리
- [`../src/common/benchmark/benchmark.controller.ts`](../src/common/benchmark/benchmark.controller.ts)
  - benchmark scenario endpoint 에 더 엄격한 override 적용

예시:

- `/auth/check-status`는 일반 API보다 낮은 limit 을 적용하고, `/internal/benchmark/scenarios/*`는 관리자 API 중에서도 더 낮은 limit 을 적용한다.

### 7. `devops-use-logging`

환경별 로깅 포맷과 HTTP 로그 레벨 정책을 일관되게 유지하는 규칙이다.

실제 반영 사례:

- [`../src/common/logger/winston.config.ts`](../src/common/logger/winston.config.ts)
  - dev: pretty console
  - production: JSON + rotate file
- [`../src/common/interceptors/logging.interceptor.ts`](../src/common/interceptors/logging.interceptor.ts)
  - request/response logging
  - slow request warn
  - `4xx -> warn`, `5xx -> error`

예시:

- production 에서는 성공 로그도 남기지만, 느린 요청은 `warn` 으로 승격하고 `/health`, `/api-docs` 같은 운영 잡음 경로는 제외한다.

### 8. `devops-use-config-module`

환경 의존 설정을 코드에 하드코딩하지 않고 `ConfigModule`/`ConfigService` 로 관리하는 규칙이다.

실제 반영 사례:

- [`../src/app.module.ts`](../src/app.module.ts)
- [`../src/common/supabase/supabase.module.ts`](../src/common/supabase/supabase.module.ts)
- [`../src/common/swagger/swagger-basic-auth.util.ts`](../src/common/swagger/swagger-basic-auth.util.ts)

예시:

- Swagger 와 관리자 API 보호는 `SWAGGER_ADMIN_USERNAME`, `SWAGGER_ADMIN_PASSWORD`를 공용으로 사용하고, 값이 없으면 Swagger 를 비활성화한다.

## 공통 리팩토링 원칙

### 1. 글로벌 예외 흐름 정리

적용 코드:

- [`../src/common/filters/api-exception.filter.ts`](../src/common/filters/api-exception.filter.ts)
- [`../src/common/api-response.dto.ts`](../src/common/api-response.dto.ts)
- [`../src/main.ts`](../src/main.ts)

반영 내용:

- `HttpException`과 일반 예외를 모두 `ErrorResponseDto`로 정규화
- validation error 의 배열 메시지도 공통 응답 포맷에서 수용
- controller 에서 `try/catch + ErrorResponseDto.create()` 패턴 제거

### 2. 인증 사용자 식별 공통화

적용 코드:

- [`../src/common/decorators/current-user-id.decorator.ts`](../src/common/decorators/current-user-id.decorator.ts)
- [`../src/user/user.controller.ts`](../src/user/user.controller.ts)
- [`../src/user/user-stats.controller.ts`](../src/user/user-stats.controller.ts)

반영 내용:

- `req.user?.userId` 반복 제거
- 인증 실패를 `UnauthorizedException` 으로 공통 처리

### 3. 운영 보안/로그/제한 정책 공통화

적용 코드:

- [`../src/common/auth/basic-auth.util.ts`](../src/common/auth/basic-auth.util.ts)
- [`../src/common/guards/admin-basic-auth.guard.ts`](../src/common/guards/admin-basic-auth.guard.ts)
- [`../src/common/rate-limit/rate-limit.util.ts`](../src/common/rate-limit/rate-limit.util.ts)
- [`../src/common/interceptors/logging.interceptor.ts`](../src/common/interceptors/logging.interceptor.ts)

반영 내용:

- 관리자 API 를 Swagger 계정 재사용 Basic Auth 로 보호
- 전역 rate limit + endpoint override 적용
- dev / production 별 로깅 정책 분리

## 도메인별 기존 문제점과 적용한 리팩토링

## `auth` + `user`

### 기존 문제점

- controller 에 `try/catch + HttpException + ErrorResponseDto.create()` 패턴이 많았다.
- `req.user?.userId` 추출과 `401` 검증이 여러 메서드에 반복됐다.
- PKCE callback 3개가 provider 이름만 다른 거의 동일한 흐름이었다.

### 적용한 리팩토링

- [`../src/auth/auth.controller.ts`](../src/auth/auth.controller.ts)
  - 단순 오케스트레이션 메서드의 `try/catch` 제거
  - Google/Kakao/Naver PKCE callback 을 `handlePkceCallback()` helper 로 통합
  - `check-status`, `logout` 응답 조립 helper 분리
  - debug endpoint 에 관리자 Basic Auth + admin rate limit 적용
- [`../src/auth/dto/exchange-token.dto.ts`](../src/auth/dto/exchange-token.dto.ts)
  - `codeVerifier` DTO 검증으로 승격
- [`../src/user/user.controller.ts`](../src/user/user.controller.ts)
- [`../src/user/user-stats.controller.ts`](../src/user/user-stats.controller.ts)
  - `@CurrentUserId()` 적용으로 인증 사용자 추출 공통화

### 유지한 외부 계약

- `/auth/*`, `/user/*` URL 과 응답 구조 유지
- JWT Guard 기반 보호 구조 유지

## `stations`

### 기존 문제점

- controller 가 좌표/반경 검증, query 조합, 삭제 전 조회를 직접 처리했다.
- `realtime-sync/batch` 는 controller 가 번호 → id 해석과 결과 집계를 직접 수행했다.
- `nearby`, `map-area`, `findOne` 의 조회 흐름이 controller 에 과도하게 몰려 있었다.

### 적용한 리팩토링

- [`../src/stations/services/station-request-validation.service.ts`](../src/stations/services/station-request-validation.service.ts)
  - 좌표/반경 검증 전담
- [`../src/stations/services/station-read-facade.service.ts`](../src/stations/services/station-read-facade.service.ts)
  - `nearby`, `map-area`, `findAll`, `findOne` 조회 orchestration 전담
- [`../src/stations/services/station-batch-realtime-sync.service.ts`](../src/stations/services/station-batch-realtime-sync.service.ts)
  - 번호 → id 해석, batch sync, 성공/실패 집계 전담
- [`../src/stations/stations.controller.ts`](../src/stations/stations.controller.ts)
  - public read endpoint 를 thin controller 구조로 정리
  - 위험 endpoint 에 `@AdminProtected()` + admin rate limit 적용
- [`../src/stations/services/station-management.service.ts`](../src/stations/services/station-management.service.ts)
  - `removeByNumber()` 추가로 controller 삭제 전 조회 책임 제거

### 유지한 외부 계약

- `/stations/*` URL 과 응답 구조 유지
- PostGIS/raw query 기반 조회 구조 유지

## `routes` + `navigation`

### 기존 문제점

- routes/navigation 계층에 문자열 기반 raw `Error` 가 많아 controller thin 구조를 방해했다.
- GraphHopper 실패와 사용자 입력 오류가 같은 방식으로 섞여 있었다.
- navigation 관련 세션/경로 조회 실패가 의미 없는 일반 예외로 처리되는 구간이 있었다.

### 적용한 리팩토링

- [`../src/routes/services/graphhopper.service.ts`](../src/routes/services/graphhopper.service.ts)
  - 경로 없음은 `BadRequestException`
  - 외부 엔진 호출 실패는 `InternalServerErrorException`
- [`../src/routes/services/station-route.service.ts`](../src/routes/services/station-route.service.ts)
- [`../src/routes/services/route-util.service.ts`](../src/routes/services/route-util.service.ts)
  - 좌표/경로 조건 오류를 `BadRequestException` 으로 정리
- [`../src/navigation/services/navigation-session.service.ts`](../src/navigation/services/navigation-session.service.ts)
- [`../src/navigation/services/navigation-helper.service.ts`](../src/navigation/services/navigation-helper.service.ts)
  - 세션/경로 조회 실패는 `NotFoundException`
  - 파싱 실패는 `InternalServerErrorException`
- [`../src/navigation/navigation.controller.ts`](../src/navigation/navigation.controller.ts)
- [`../src/routes/routes.controller.ts`](../src/routes/routes.controller.ts)
  - 수동 예외 래핑 제거

### 유지한 외부 계약

- `/routes/*`, `/navigation/*` URL 과 응답 DTO 유지
- GraphHopper 연동, Redis 세션 구조 유지

## `tts`

### 기존 문제점

- controller 가 `result.status === 'error'` 검사와 예외 변환을 직접 처리했다.
- 스토리지, provider, merge 단계에서 raw error 성격의 실패가 상위로 섞여 올라왔다.

### 적용한 리팩토링

- [`../src/tts/tts.service.ts`](../src/tts/tts.service.ts)
  - `synthesizeAndCacheOrThrow()`
  - `synthesizePermanentOrThrow()`
  - service 레벨에서 안전한 오류 메시지 처리
- [`../src/tts/tts.controller.ts`](../src/tts/tts.controller.ts)
  - 수동 `try/catch` 제거
- [`../src/tts/services/tts-storage.service.ts`](../src/tts/services/tts-storage.service.ts)
  - 스토리지 실패를 `InternalServerErrorException` 으로 통일
- [`../src/tts/tts.provider.ts`](../src/tts/tts.provider.ts)
  - credential/audioContent/합성 실패를 표준 예외로 정리
- [`../src/tts/services/tts-synthesis.service.ts`](../src/tts/services/tts-synthesis.service.ts)
  - 빈 merge 입력, ffmpeg merge 실패를 표준 예외로 정리

### 유지한 외부 계약

- `fulltext` / `chunked` 합성 전략 유지
- Redis phrase cache 와 Supabase Storage 구조 유지

## `location` + `map` + `app/common bootstrap`

### 기존 문제점

- location controller 가 외부 API 오류를 직접 감쌌다.
- bootstrap 이 복잡했고 공통 예외/로깅 정책이 분산돼 있었다.
- 운영 보안 정책과 Swagger 정책이 별개처럼 흩어져 있었다.

### 적용한 리팩토링

- [`../src/location/location.service.ts`](../src/location/location.service.ts)
  - 외부 API 오류를 `InternalServerErrorException` 으로 일관 처리
- [`../src/location/location.controller.ts`](../src/location/location.controller.ts)
  - controller `try/catch` 제거
- [`../src/main.ts`](../src/main.ts)
  - bootstrap 단순화
  - 전역 예외 필터, 로깅 인터셉터, Swagger Basic Auth, trust proxy 등록
- [`../src/common/swagger/swagger-basic-auth.util.ts`](../src/common/swagger/swagger-basic-auth.util.ts)
  - Swagger 보호 로직 공용화

### 유지한 외부 계약

- `/locations/*`, `/map`, Swagger 문서 경로 유지
- ValidationPipe, Sentry, LoggingInterceptor 유지

## 남은 기술부채 / 후속 과제

- [`../src/stations/services/seoul-api.service.ts`](../src/stations/services/seoul-api.service.ts), [`../src/mail/mail.service.ts`](../src/mail/mail.service.ts), 일부 OAuth strategy 에는 여전히 legacy error/logging 패턴이 남아 있다.
- `MailService`, Kakao/Naver strategy 는 `console.*` 와 raw `Error` 를 아직 사용하므로 Nest Logger + 표준 예외로 정리할 여지가 있다.
- TTS 는 `status: error` 반환 전략과 예외 전략이 공존하므로 장기적으로 domain-specific exception 클래스로 더 정교하게 분리할 수 있다.
- benchmark/admin endpoint 는 보호는 적용됐지만, 운영 전용 module/controller 로 더 분리할 여지가 있다.

## 테스트 요약

- `pnpm exec jest src/common/filters/api-exception.filter.spec.ts --runInBand`
- `pnpm exec jest src/stations/services/station-request-validation.service.spec.ts src/routes/services/route-util.service.spec.ts src/tts/tts.service.spec.ts --runInBand`
- `pnpm exec jest src/common/guards/admin-basic-auth.guard.spec.ts src/common/interceptors/logging.interceptor.spec.ts src/common/swagger/swagger-basic-auth.util.spec.ts --runInBand`
- `pnpm run build`
