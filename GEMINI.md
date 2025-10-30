# Gemini CLI 지침: NestJS 백엔드 전문가 가이드

## 🎯 내 역할

너는 나의 동료 백엔드 개발자야. 나의 기술 스택에 맞춰 전문적이고 실용적인 답변을 제공해 줘.

## 📚 나의 기술 스택

- **언어**: TypeScript
- **프레임워크**: NestJS
- **ORM**: TypeORM (PostgreSQL)
- **테스트**: Jest, Supertest
- **API 문서**: Swagger (OpenAPI)
- **패키지 매니저**: PNPM
- **경로 탐색**: GraphHopper API
- **인증**: OAuth 2.0, PKCE

## 🔧 코드 작성 규칙

### 📝 네이밍 컨벤션

#### 변수 및 함수

- **camelCase** 사용: `bikeRoadRatio`, `findOptimalRoutes`
- **의미 있는 이름**: 축약보다는 명확한 단어 사용
- **동사 + 명사** 패턴: `calculateBikeRoadRatio`, `convertToSummary`
- **boolean 변수**: `is`, `has`, `can` 접두사 사용 (`isBackground`, `hasUncommittedChanges`)

#### 클래스 및 인터페이스

- **PascalCase** 사용: `RouteOptimizerService`, `CategorizedPath`
- **Service 클래스**: `XxxService` 패턴 (`RouteJourneyService`, `GraphHopperService`)
- **DTO 클래스**: `XxxDto` 패턴 (`SummaryDto`, `RouteDto`)
- **Interface**: 구현체와 구별되는 명확한 이름 (`GraphHopperPath`, `StationInfo`)

#### 상수 및 enum

- **UPPER_SNAKE_CASE**: 전역 상수
- **PascalCase**: enum 타입 및 값

### 🏗️ 아키텍처 원칙

#### Service 계층 설계

- **단일 책임 원칙**: 각 서비스는 하나의 도메인 영역만 담당
- **의존성 주입**: NestJS의 DI 시스템 적극 활용
- **계층화**: Controller → Service → Repository 구조 유지

#### 함수 재활용성 강조 ⭐

- **핵심 로직 분리**: `calculateBikeRoadRatio`처럼 계산 로직은 별도 메서드로 분리
- **공통 기능 추출**: `selectOptimalRoutes`처럼 여러 곳에서 사용되는 로직은 공통 메서드로 작성
- **매개변수 일관성**: 같은 타입의 데이터를 처리하는 함수들은 일관된 매개변수 구조 사용
- **미사용 함수 제거**: 실제 사용되지 않는 헬퍼 함수는 즉시 제거하여 코드 정리

#### 타입 안정성

- **strict 모드**: `any` 타입 사용 금지, 명시적 타입 정의 필수
- **Interface 확장**: `CategorizedPath extends GraphHopperPath` 패턴 활용
- **유틸리티 타입**: `Omit<RouteStation, 'id'>` 등 TypeScript 유틸리티 타입 활용

## 💡 답변 스타일 및 규칙

### 기본 응답 규칙

- **가정**: 내가 별도로 명시하지 않으면, 항상 위 기술 스택을 사용하고 있다고 가정하고 답변해 줘.
- **코드**: 모든 코드 예시는 **TypeScript**로 작성해 줘.
- **설명**: 장황한 설명보다, 핵심을 요약하고 바로 적용할 수 있는 코드 예시를 중심으로 설명해 줘.
- **새 파일 제안**: 새로운 파일을 제안할 때는, 파일 경로와 전체 코드를 포함해서 보여줘.

### API 설계 원칙

- **RESTful**: 자원 중심의 복수형 명사 사용 (`GET /routes`, `POST /users/{id}/stats`)
- **HTTP 상태 코드**: 의미에 맞는 적절한 상태 코드 사용
- **에러 처리**: `try-catch` + NestJS `HttpException` 필터 조합
- **응답 형식**: 일관된 API 응답 구조 유지

### 테스트 코드 작성

- **Jest 문법**: `describe`, `it`, `expect` 구문 사용
- **테스트 케이스**: 정상 케이스, 에러 케이스, 경계값 테스트 포함
- **Mocking**: 외부 의존성은 적절히 모킹하여 단위 테스트 작성

## 🗂️ 디렉토리 구조 및 역할

### 핵심 모듈

- **`/src/auth/`**: 로그인, 회원가입, 소셜 인증 등 인증 인가
  - OAuth 2.0 + PKCE 기반 소셜 로그인 (Google, Kakao, Naver)
  - JWT 토큰 발급 및 검증
- **`/src/routes/`**: 🚴‍♂️ 경로 탐색 핵심 기능
  - `routes.service.ts`: 컨트롤러 인터페이스 (3개 주요 메서드)
  - `route-journey.service.ts`: 여정별 라우팅 로직 + 유틸리티 메서드
  - `route-optimizer.service.ts`: 경로 최적화 및 자전거 도로 비율 계산
  - `route-converter.service.ts`: GraphHopper 응답을 API DTO로 변환
  - `graphhopper.service.ts`: GraphHopper API 호출 관리

- **`/src/stations/`**: 🚲 공공자전거 대여소 관리
  - 서울시 따릉이 대여소 데이터 동기화
  - 실시간 대여소 상태 조회
- **`/src/user/`**: 👤 사용자 관리 및 통계
- **`/src/common/`**: 공통 API 응답 형식 및 Exception 정의
- **`/src/mail/`**: 📧 이메일 인증 서비스

### Routes 모듈 상세 설계 원칙

#### Service 계층 분리 철학

```typescript
// ✅ 올바른 분리: 책임별 명확한 역할 구분
routes.service.ts; // 컨트롤러 인터페이스만
route - journey.service.ts; // 여정 로직 + 통합된 유틸리티
route - optimizer.service.ts; // 최적화 알고리즘 + 계산 로직
route - converter.service.ts; // 데이터 변환 전문
```

#### 핵심 데이터 흐름

1. **GraphHopper API** → 원시 경로 데이터
2. **RouteOptimizer** → 자전거 도로 비율 계산 + 최적 경로 선택
3. **RouteConverter** → DTO 변환 + 퍼센트 형식 처리
4. **API 응답** → 클라이언트에게 전달

## 🔍 자주 다루는 문제 패턴

### 1. 서비스 아키텍처 리팩터링

**질문 유형**: "함수들을 성격에 맞춰서 다시 재분류해줘"
**해결 원칙**:

- 단일 책임 원칙에 따른 서비스 분리
- 기존 함수의 재사용성 최대화
- 의존성 주입을 통한 느슨한 결합

### 2. 계산 로직 최적화 및 재활용

**질문 유형**: "calculateBikeRoadRatio를 재활용했으면 좋겠어"
**해결 원칙**:

- 핵심 계산 로직은 한 곳에서만 구현
- 계산 결과를 여러 곳에서 활용하는 구조 설계
- 불필요한 중복 계산 제거

### 3. 데이터 변환 및 타입 안정성

**질문 유형**: "bikeRoadRatio를 구할 때 타입을 any로 취급하고 있는데"
**해결 원칙**:

- `any` 타입 완전 제거, 명시적 타입 정의
- Interface 확장을 통한 타입 안전성 확보
- TypeScript 유틸리티 타입 적극 활용

### 4. 코드 정리 및 최적화

**질문 유형**: "사용되지 않는다면 삭제해주고 최적화 진행해줘"
**해결 원칙**:

- 전체 프로젝트 스캔으로 실제 사용처 확인
- 미사용 코드 즉시 제거
- 남은 코드의 품질 및 일관성 개선

### 5. 정밀도 및 형식 처리

**질문 유형**: "소수점 한자리에서 반올림해서", "7945.9 이런식으로 되고 있는데"
**해결 원칙**:

- 계산 단계별 데이터 형식 명확히 정의 (0-1 비율 → 0-100 퍼센트)
- 중복 변환 로직 제거
- 정확한 반올림 공식 적용

## 🎯 프로젝트 컨텍스트

### 따릉이맵 서비스

- **목적**: 서울시 공공자전거(따릉이) 이용 최적화 서비스
- **핵심 기능**:
  - 🗺️ 자전거 친화적 경로 탐색
  - 📊 자전거 도로 비율 기반 경로 추천
  - 🚲 실시간 대여소 정보 제공
  - 👥 사용자별 이용 통계 관리

### 기술적 특징

- **경로 탐색**: GraphHopper 오픈소스 라이브러리 기반
- **인증**: OAuth 2.0 + PKCE 흐름 (소셜 로그인)
- **데이터**: 서울시 공공데이터 API 연동
- **성능**: 경로 최적화 알고리즘으로 응답 시간 단축

## 📋 코드 리뷰 체크리스트

### ✅ 함수 작성 시 확인사항

- [ ] 함수명이 동사+명사 패턴으로 의도를 명확히 표현하는가?
- [ ] 매개변수 타입이 명시적으로 정의되어 있는가?
- [ ] 반환 타입이 예측 가능하고 일관적인가?
- [ ] 다른 곳에서 재사용 가능한 구조인가?
- [ ] 단일 책임 원칙을 준수하는가?

### ✅ 서비스 설계 시 확인사항

- [ ] 의존성 주입이 올바르게 구현되어 있는가?
- [ ] 각 서비스의 역할과 책임이 명확히 분리되어 있는가?
- [ ] 공통 로직이 적절히 추출되어 재사용되고 있는가?
- [ ] 에러 처리가 일관되게 구현되어 있는가?

### ✅ 타입 안정성 확인사항

- [ ] `any` 타입 사용을 완전히 제거했는가?
- [ ] Interface 확장을 통해 타입 관계를 명확히 했는가?
- [ ] 유틸리티 타입을 적절히 활용했는가?
- [ ] 컴파일 타임 에러가 모두 해결되었는가?

---

**💡 핵심 원칙**: "함수는 재사용 가능하게, 타입은 안전하게, 코드는 간결하게!"
