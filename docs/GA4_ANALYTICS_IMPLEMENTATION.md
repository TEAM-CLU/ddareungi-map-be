# GA4 Analytics Implementation

이 문서는 현재 코드 기준으로 GA4 Measurement Protocol 서버사이드 연동이 어떻게 동작하는지 설명한다.

기준 코드:

- [`../src/analytics/analytics.module.ts`](../src/analytics/analytics.module.ts)
- [`../src/analytics/analytics.service.ts`](../src/analytics/analytics.service.ts)
- [`../src/analytics/ga4-measurement-protocol.client.ts`](../src/analytics/ga4-measurement-protocol.client.ts)
- [`../src/analytics/analytics-identity.resolver.ts`](../src/analytics/analytics-identity.resolver.ts)
- [`../src/stations/stations.controller.ts`](../src/stations/stations.controller.ts)
- [`../src/routes/routes.controller.ts`](../src/routes/routes.controller.ts)
- [`../src/navigation/navigation.controller.ts`](../src/navigation/navigation.controller.ts)

## 1. 왜 백엔드에서 직접 GA4를 보내는가

현재 프로젝트는 프런트엔드에 GA SDK를 붙이지 않고, NestJS 백엔드가 직접 GA4 Measurement Protocol로 이벤트를 전송한다.

이 구조를 선택한 이유:

- 핵심 KPI가 백엔드 API 성공 흐름과 직접 연결되어 있다.
- station search, route search, navigation start/update/end는 모두 서버가 실제 완료 여부를 가장 정확히 안다.
- 프런트엔드 SDK 없이도 익명/로그인 사용자를 모두 추적할 수 있다.
- 운영 관점에서 실패율, 응답 시간 같은 system event를 같은 방식으로 함께 보낼 수 있다.

즉 현재 analytics는 “사용자 행동 추적”과 “핵심 API 품질 추적”을 모두 백엔드에서 책임지는 구조다.

## 2. 전체 구조

analytics는 `src/analytics` 아래 독립 feature module로 분리되어 있다.

구성 요소:

- `AnalyticsModule`
  - feature module
  - `AnalyticsService`, `Ga4MeasurementProtocolClient`, `AnalyticsIdentityResolver`를 등록하고 export 한다.
- `AnalyticsService`
  - 외부에서 사용하는 단일 facade
  - `trackEvent()`만 public으로 노출한다.
  - analytics 활성화 여부 판단, undefined/null param 제거, fire-and-forget 호출, 실패 swallow를 담당한다.
- `Ga4MeasurementProtocolClient`
  - 순수 transport 계층
  - 실제 GA4 HTTP 요청 생성과 전송만 담당한다.
- `AnalyticsIdentityResolver`
  - request header와 optional JWT에서 `clientId`, `userId`, `authState`를 만든다.

이 분리는 NestJS best practice 관점에서 중요하다.

- controller는 “언제 무엇을 보낼지”만 결정한다.
- facade service는 “보내도 되는 상태인지, 안전하게 보낼지”를 책임진다.
- transport client는 “어떤 HTTP payload로 보낼지”만 책임진다.
- identity resolver는 “누구의 이벤트인지”를 책임진다.

즉 도메인 규칙, 전송 규칙, 식별 규칙이 한 서비스에 섞이지 않도록 분리되어 있다.

## 3. 모듈이 앱에 연결되는 방식

`AnalyticsModule`은 아래 feature module에서 import 된다.

- `StationsModule`
- `RoutesModule`
- `NavigationModule`

이 의미는 다음과 같다.

- station search, route search, navigation API는 controller에서 analytics를 직접 주입받아 호출한다.
- analytics 때문에 기존 domain service 시그니처를 늘리지 않는다.
- request 객체를 가장 잘 알고 있는 controller가 identity resolve와 timing 측정을 담당한다.

또한 `AnalyticsModule`은 `JwtModule.registerAsync(...)`를 사용한다.

이유:

- `stations/routes/navigation` endpoint는 현재 전부 JWT guard가 붙어 있지 않다.
- 따라서 `request.user`가 항상 채워져 있지 않다.
- 로그인 사용자의 `user_id`를 보강하려면 `Authorization: Bearer ...` 헤더를 analytics 쪽에서 optional decode 해야 한다.
- 이 로직을 controller마다 복제하지 않고 `AnalyticsIdentityResolver` 하나에 모아둔 것이다.

## 4. 환경변수와 활성화 조건

현재 analytics 활성화 조건은 매우 단순하다.

- `GA4_MEASUREMENT_ID`
- `GA4_API_SECRET`

두 값이 모두 있어야 활성화된다.

동작 방식:

1. `AnalyticsService` constructor에서 두 환경변수를 읽는다.
2. 둘 다 truthy면 `enabled = true`가 된다.
3. 하나라도 없으면 `enabled = false`가 된다.
4. 비활성 상태에서 `trackEvent()`가 호출되면 전송은 하지 않고 no-op 처리한다.
5. 대신 noisy log를 피하기 위해 경고 로그는 프로세스 생애주기 기준 1회만 남긴다.

이 구조 덕분에:

- 로컬 개발 환경에서 GA4 설정이 없어도 애플리케이션은 정상 동작한다.
- 운영 환경에서 설정 누락이 있어도 비즈니스 API는 깨지지 않는다.
- analytics를 feature flag처럼 다룰 수 있다.

## 5. request가 들어왔을 때 실제로 어떤 순서로 동작하는가

### 5.1 공통 흐름

`stations`, `routes`, `navigation` controller는 거의 같은 패턴을 따른다.

1. `startedAt = Date.now()`로 시작 시각을 기록한다.
2. `AnalyticsIdentityResolver.resolve(request)`로 사용자 식별 정보를 만든다.
3. 실제 비즈니스 서비스를 호출한다.
4. 성공하면:
   - 사용자 행동 event를 보낸다.
   - `api_operation_result(outcome=success)`를 보낸다.
5. 실패하면:
   - `api_operation_result(outcome=error)`를 보낸다.
   - 예외는 그대로 다시 throw 한다.

즉 analytics는 “부수효과(side effect)”이며, 본 API 성공/실패 semantics를 바꾸지 않는다.

### 5.2 왜 성공 event와 system event를 나눠서 보내는가

예를 들어 route search 성공 시에는 두 이벤트가 간다.

- `route_search_completed`
- `api_operation_result`

분리 이유:

- `route_search_completed`는 KPI와 사용자 행동 분석용이다.
- `api_operation_result`는 실패율과 응답 시간 추적용이다.

둘을 하나로 합치면 조회가 불편해진다.

- KPI 쿼리는 “사용자가 얼마나 route search를 썼는가”를 보고 싶다.
- 운영 쿼리는 “route search API가 얼마나 느렸는가 / 얼마나 실패했는가”를 보고 싶다.

현재 구현은 이 두 목적을 명확히 분리한다.

## 6. Identity 해석 원리

`AnalyticsIdentityResolver`는 모든 analytics event의 `identity`를 만든다.

반환 타입:

- `clientId`
- optional `userId`
- `authState`

### 6.1 client_id 우선순위

우선순위는 아래와 같이 고정되어 있다.

1. `X-GA-Client-Id`
2. `X-Anonymous-App-Id`
3. 서버가 생성한 임시 UUID

#### 1) `X-GA-Client-Id`

프런트가 실제 GA client id를 전달할 수 있으면 이 값을 최우선으로 사용한다.

의미:

- 프런트에서 이미 식별 기준을 가지고 있는 경우 그 식별자를 서버 이벤트와 일치시킬 수 있다.
- 나중에 frontend GA를 붙이더라도 같은 사용자 세션/디바이스 식별자를 맞추기 쉬워진다.

#### 2) `X-Anonymous-App-Id`

현재 기본 시나리오는 React Native 앱이 `X-Anonymous-App-Id`를 매 요청에 보내는 것이다.

의미:

- 쿠키가 없는 모바일 환경에서도 익명 사용자 재방문을 식별할 수 있다.
- revisit rate를 계산할 때 로그인 여부와 무관하게 안정적인 기준이 된다.

#### 3) 임시 UUID fallback

두 헤더가 모두 없으면 resolver가 `randomUUID()`로 임시 `clientId`를 만든다.

의미:

- 이벤트 드롭은 막을 수 있다.
- 하지만 요청마다 새 값이 생길 수 있으므로 revisit KPI 정확도는 낮아진다.

그래서 구현은 warning 로그를 1회 남긴다.

- 운영자가 “client_id 품질이 낮은 요청이 들어오고 있다”는 사실을 알 수 있게 한다.
- 하지만 매 요청마다 경고하지는 않아서 로그 오염은 막는다.

### 6.2 user_id 결정 방식

`userId`는 다음 순서로 결정된다.

1. `request.user?.userId`
2. `Authorization: Bearer ...` JWT decode 결과의 `userId` 또는 `sub`

공개 endpoint라서 guard가 없을 수 있으므로, 현재는 2번이 중요하다.

동작:

- Authorization 헤더가 있고 `Bearer `로 시작하면 JWT verify를 시도한다.
- payload의 `userId` 또는 `sub`를 문자열로 정규화한다.
- 실패하면 예외를 던지지 않고 anonymous로 처리한다.

이렇게 한 이유:

- analytics 때문에 인증 흐름을 강제하면 안 된다.
- “로그인 사용자의 식별 강화”는 best effort 여야 한다.
- 토큰이 없거나 깨져 있어도 본 요청은 원래 정책대로 처리되어야 한다.

### 6.3 auth_state

`authState`는 `userId` 존재 여부로 결정된다.

- `userId` 있음: `authenticated`
- `userId` 없음: `anonymous`

이 값은 거의 모든 이벤트의 param에 함께 들어가므로, GA4에서 로그인 사용자와 익명 사용자를 쉽게 분리해서 볼 수 있다.

## 7. `AnalyticsService.trackEvent()`가 하는 일

이 메서드는 외부에서 analytics를 사용할 때의 유일한 진입점이다.

핵심 책임은 네 가지다.

### 7.1 활성화 여부 판단

서비스 생성 시점에 읽어둔 `enabled` 값이 false면 즉시 리턴한다.

즉 controller는 아래를 신경 쓸 필요가 없다.

- 지금 환경에서 analytics가 켜져 있는지
- env가 비어 있는지
- transport client를 직접 호출해야 하는지

### 7.2 undefined / null param 제거

GA4 이벤트 param은 값이 없는 필드까지 다 보내면 분석 데이터가 지저분해진다.

현재 구현은 다음 값을 제거한다.

- `undefined`
- `null`

남기는 값:

- `string`
- `number`
- `boolean`

이 정리는 controller마다 하지 않고 중앙에서 한 번만 한다.

예를 들어:

- `radius_bucket`은 `map-area`에만 있고 `nearby`에는 없다.
- `error_type`은 실패 시에만 있다.
- `user_id`는 로그인 사용자에게만 있다.

이런 선택 필드는 전부 `trackEvent()`가 안전하게 정리한다.

### 7.3 fire-and-forget 전송

`trackEvent()`는 `void this.ga4Client.sendEvent(...).catch(...)` 형태로 호출한다.

이 구조의 의미:

- controller는 전송 완료를 기다리지 않는다.
- GA4가 느리거나 일시 장애가 있어도 API 응답 자체는 계속 진행된다.
- analytics는 관측 부가기능이지, 핵심 비즈니스 트랜잭션 일부가 아니다.

### 7.4 전송 실패 swallow

`sendEvent()`가 실패해도 `trackEvent()` 내부에서 `catch` 후 warning만 남긴다.

그래서 아래가 보장된다.

- station search가 성공했는데 GA4가 실패했다고 500이 되지 않는다.
- route search나 navigation start/end의 정상 응답이 analytics 때문에 깨지지 않는다.

이건 서버사이드 analytics에서 가장 중요한 안전장치다.

## 8. 실제 GA4 HTTP 요청이 만들어지는 방식

`Ga4MeasurementProtocolClient`는 transport 전담 클래스다.

전송 endpoint:

- `https://www.google-analytics.com/mp/collect`

쿼리 파라미터:

- `measurement_id`
- `api_secret`

request body 구조:

```json
{
  "client_id": "client-id",
  "user_id": "42",
  "events": [
    {
      "name": "route_search_completed",
      "params": {
        "route_search_type": "full_journey"
      }
    }
  ]
}
```

핵심 포인트:

- `client_id`는 항상 보낸다.
- `user_id`는 있을 때만 포함한다.
- 한 번의 호출에 현재 구현은 이벤트 1개만 담는다.
- `HttpService.axiosRef.post(...)`를 사용하므로 별도 RxJS 변환 없이 단순 HTTP 호출로 끝난다.

또한 `HttpLoggingModule`이 앱 전역에 붙어 있으므로, outbound HTTP 레벨에서 공통 로깅 정책을 함께 탈 수 있다.

## 9. 이벤트별 실제 발생 지점과 파라미터

### 9.1 station search

발생 지점:

- `GET /stations/nearby`
- `GET /stations/map-area`

성공 시에만 `station_search`를 보낸다.

파라미터:

- `search_type`
  - `nearby`
  - `map_area`
- `format`
  - `json`
  - `geojson`
- `radius_bucket`
  - `map-area`일 때만 존재
- `result_count_bucket`
- `auth_state`

보내지 않는 것:

- raw latitude / longitude
- raw radius
- station id, station name

즉 개인정보와 고카디널리티 값을 피하면서, 분석에 필요한 추상화된 정보만 보낸다.

### 9.2 route search

발생 지점:

- `POST /routes/full-journey`
- `POST /routes/circular-journey`

성공 시 `route_search_completed`를 보낸다.

파라미터:

- `route_search_type`
  - `full_journey`
  - `circular_journey`
- `journey_shape`
  - `direct`
  - `multi_leg`
  - `round_trip`
  - `circular`
- `waypoint_count`
- `result_count`
- `auth_state`

이 이벤트가 route search usage rate KPI의 핵심 numerator다.

### 9.3 navigation started

발생 지점:

- `POST /navigation/start`

성공 시 `navigation_started`를 보낸다.

파라미터:

- `instruction_count_bucket`
- `waypoint_count`
- `auth_state`

이 이벤트가 navigation usage rate KPI의 핵심 numerator다.

### 9.4 navigation updated

발생 지점:

- `POST /navigation/:sessionId/return`
- `POST /navigation/:sessionId/reroute`

성공 시 `navigation_updated`를 보낸다.

파라미터:

- `update_type`
  - `return`
  - `reroute`
- `travel_mode`
  - 기본값은 현재 구현상 `biking`
- `remaining_waypoint_count`
- `auth_state`

### 9.5 navigation completed

발생 지점:

- `DELETE /navigation/:sessionId`

성공 시 `navigation_completed`를 보낸다.

파라미터:

- `completion_type=user_end`
- `auth_state`

### 9.6 api_operation_result

이 이벤트는 사용자 행동 event와 별도로 거의 모든 analytics 대상 API에서 같이 전송된다.

파라미터:

- `feature_area`
  - `station_search`
  - `route_search`
  - `navigation`
- `operation_name`
- `outcome`
  - `success`
  - `error`
- `duration_ms`
- `http_status`
- `error_type`
  - 실패 시에만 존재
- `auth_state`

이 이벤트의 역할:

- 사용자 행동과 운영 품질을 분리해서 본다.
- API별 성공/실패 비율과 응답 시간 분포를 같이 분석한다.

## 10. bucket 함수가 왜 필요한가

현재 구현은 GA4에 raw count/raw radius를 그대로 보내지 않고 bucket으로 보낸다.

함수:

- `toRadiusBucket()`
- `toResultCountBucket()`
- `toInstructionCountBucket()`

이 방식의 장점:

- cardinality를 낮춘다.
- dashboard가 더 읽기 쉬워진다.
- 개인정보/민감도 이슈를 줄인다.
- “세밀한 수치”보다 “행동 패턴”을 보는 KPI 목적에 더 잘 맞는다.

예:

- `radius=742` 대신 `501_1000`
- `instruction_count=13` 대신 `6_15`

## 11. 왜 heartbeat는 추적하지 않는가

`POST /navigation/:sessionId/heartbeat`는 현재 analytics를 보내지 않는다.

이유:

- 주기 호출이 많아서 event volume이 쉽게 커진다.
- 사용자 의도보다 세션 유지 구현 세부사항에 가깝다.
- KPI와 직접 연결되는 의미가 약하다.
- `navigation_started` / `navigation_completed` / `navigation_updated`와 semantics가 겹칠 위험이 있다.

즉 현재 구현은 “의미 있는 상태 전이”만 추적하고, 고빈도 유지 이벤트는 제외한다.

## 12. KPI와 이벤트의 연결

### 12.1 route search usage rate

가장 중요한 기본 이벤트:

- `route_search_completed`

해석:

- route search를 실제로 성공적으로 사용한 횟수
- `route_search_type`, `journey_shape`로 세분화 가능

### 12.2 navigation usage rate

가장 중요한 기본 이벤트:

- `navigation_started`
- 보조적으로 `navigation_completed`

해석:

- 사용자가 경로 검색 후 실제 네비게이션으로 진입했는지
- 종료까지 이어지는지

### 12.3 revisit rate

별도 revisit 전용 custom event를 만들지 않는다.

대신 아래 event들의 `client_id` / `user_id`를 기준으로 재방문을 해석한다.

- `route_search_completed`
- `navigation_started`
- `station_search`

이 설계가 중요한 이유:

- revisit는 “다시 왔다”는 메타 속성이지, 독립 행동 event가 아니다.
- 의미 없는 ping event보다 실제 행동 event를 기준으로 계산하는 편이 더 해석 가능성이 높다.

## 13. 오류 처리 원리

현재 구현은 analytics 때문에 본 요청이 실패하지 않도록 여러 단계로 방어한다.

### 13.1 transport 실패

`AnalyticsService.trackEvent()`가 catch해서 warning만 남긴다.

### 13.2 env 누락

analytics 자체를 비활성화하고 no-op 처리한다.

### 13.3 JWT decode 실패

anonymous 처리로 fallback 한다.

### 13.4 controller business error

비즈니스 예외는 그대로 다시 throw 한다.

대신 analytics 쪽에서는:

- `api_operation_result`
- `outcome=error`
- `http_status`
- `error_type`

를 보내서 운영 지표는 남긴다.

즉 analytics는 실패를 “가로막지 않고 관찰만” 한다.

## 14. privacy / 데이터 최소화 원칙

현재 구현은 아래 값을 보내지 않도록 설계되어 있다.

- raw latitude / longitude
- routeId
- navigation sessionId
- stationId
- station name
- 검색어 원문
- 이메일 / 전화번호 / 소셜 UID 같은 PII

로그인 사용자의 경우에도 GA4에는 `user_id`로 내부 식별자만 보내고, 사용자 프로필 정보는 보내지 않는다.

이 원칙은 꼭 유지해야 한다.

- GA4는 분석 도구지 운영 DB가 아니다.
- raw 식별값과 민감값은 cardinality 문제와 개인정보 문제를 동시에 일으킨다.

## 15. 현재 구현의 장점과 한계

### 장점

- 백엔드만으로 바로 작동한다.
- 핵심 KPI와 직접 연결된 성공 event를 서버가 정확히 기록한다.
- analytics 실패가 본 API를 깨지 않는다.
- 익명/로그인 사용자 모두 다룰 수 있다.
- controller에서 이벤트 전송 지점이 명확하다.

### 한계

- 현재는 이벤트마다 직접 HTTP 호출한다.
- batching, retry queue, dead-letter가 없다.
- frontend GA가 없으므로 화면 노출/클릭 같은 client-side 이벤트는 아직 없다.
- fallback UUID가 많아지면 revisit KPI 품질이 낮아질 수 있다.

## 16. 나중에 확장할 때의 기준

아래 상황이 생기면 direct call 구조를 queue/batching으로 확장할 수 있다.

- 이벤트 volume이 크게 증가할 때
- station polling 같은 고빈도 analytics가 추가될 때
- GA4 실패 재시도가 운영상 중요해질 때
- controller latency variance가 눈에 띄게 커질 때

그 전까지는 현재처럼 단순한 direct non-blocking 구조가 운영 복잡도 대비 가장 실용적이다.

## 17. 테스트로 보장되는 것

현재 테스트는 아래 동작을 보장한다.

- `AnalyticsIdentityResolver`
  - `X-GA-Client-Id` 우선순위
  - `X-Anonymous-App-Id` fallback
  - 임시 UUID fallback
  - valid JWT에서 `user_id` 추출
  - invalid JWT anonymous fallback
- `AnalyticsService`
  - undefined param 제거
  - analytics disabled 시 no-op
  - transport failure swallow
- `Ga4MeasurementProtocolClient`
  - GA4 payload shape 검증
- controller spec
  - 성공 시 behavior event + `api_operation_result(success)` 전송
  - 실패 시 `api_operation_result(error)` 전송
  - heartbeat는 analytics 대상에서 제외

즉 설계 의도뿐 아니라 핵심 안전장치도 테스트로 고정되어 있다.
