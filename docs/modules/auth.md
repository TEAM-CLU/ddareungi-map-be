# 인증·사용자

`src/auth/` + `src/user/` 모듈. JWT 기반 액세스 토큰 + 소셜 로그인 + 이메일 인증.

## 엔드포인트

### 자체 회원가입 / 로그인 (`/user/*`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/user/check-email` | 이메일 중복 확인 |
| `POST` | `/user/create-user` | 이메일 인증 코드 검증 후 가입 완료 |
| `POST` | `/user/login-user` | 이메일 + 비밀번호 로그인 → JWT 발급 |
| `GET` | `/user/info` | 본인 정보 조회 (JWT) |
| `PUT` | `/user/info-update` | 본인 정보 수정 (JWT) |
| `PUT` | `/user/password` | 비밀번호 변경 (JWT) |
| `GET` | `/user/mypage` | 마이페이지 집계 (JWT) |
| `DELETE` | `/user/withdraw` | 회원 탈퇴 (JWT) |
| `DELETE` | `/user/withdraw/email` | 이메일로 즉시 탈퇴 (관리자 등) |

### 이메일 인증 / 비밀번호 (`/auth/*`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/auth/send-verification-email` | 이메일 인증 코드 발송 |
| `POST` | `/auth/verify-email` | 인증 코드 확인 |
| `POST` | `/auth/find-account` | 이메일로 가입 여부 / 소셜 프로바이더 조회 |
| `POST` | `/auth/reset-password` | 인증 코드 검증 후 비밀번호 재설정 |

### 소셜 로그인

표준 코드 플로우 (passport guard):

| 진입 | 콜백 | 가드 |
|------|------|------|
| `GET /auth/google` | `GET /auth/google/callback` | `AuthGuard('google')` |
| `GET /auth/kakao`  | `GET /auth/kakao/callback`  | `AuthGuard('kakao')` |
| `GET /auth/naver`  | `GET /auth/naver/callback`  | `AuthGuard('naver')` |

PKCE 플로우 (모바일/SPA용, state·code_verifier를 자체 처리):

| 진입 | 콜백 |
|------|------|
| `GET /auth/{provider}/pkce` | `GET /auth/{provider}/pkce/callback` |

### 토큰 교환 / 상태

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/auth/exchange-token` | PKCE 콜백에서 받은 임시 코드 → JWT 교환 |
| `GET` | `/auth/check-status` | 현재 토큰 유효성 |
| `POST` | `/auth/logout` | 서버 측 세션/리프레시 무효화 |

## 흐름

### 자체 회원가입

```
1. POST /user/check-email           ← 중복 확인
2. POST /auth/send-verification-email ← Gmail SMTP로 코드 발송
3. POST /auth/verify-email          ← 코드 확인 (Redis에 임시 저장)
4. POST /user/create-user           ← 인증 통과 시 DB 저장 + JWT 발급
```

### 소셜 로그인 (표준)

```
1. GET /auth/{provider}            → 프로바이더 인증 페이지로 redirect
2. 프로바이더 → GET /auth/{provider}/callback
3. passport strategy validate → 사용자 매칭/생성 → JWT redirect
```

### 소셜 로그인 (PKCE)

```
1. 클라이언트 code_verifier/challenge 생성
2. GET /auth/{provider}/pkce?code_challenge=...
3. 콜백에서 임시 코드 발급
4. POST /auth/exchange-token { code, code_verifier } → JWT
```

## 토큰

- 액세스 토큰: `JwtModule` 서명, `JWT_EXPIRATION_TIME` 만료
- 가드: `passport-jwt` (`src/user/guards/`)
- 트레이스: `nestjs-cls` 가 `x-trace-id` / `x-request-id` 헤더를 CLS 에 저장

## 비밀번호 / 보안

- 해시: `bcrypt`
- Rate limit: 글로벌 `ThrottlerModule` (Redis 기반 트래커)
- 관리자 전용 엔드포인트: `ADMIN_API_TOKEN` Bearer

## 사용자 통계 (`/user/stats`)

`src/user/user-stats.controller.ts`:
- `POST /user/stats/update`
- `GET /user/stats`
- `DELETE /user/stats/reset`

라이딩 통계 누적 (총 거리·시간·횟수 등). NavigationModule 종료 이벤트와 연동.
