# 환경변수

`ConfigModule.forRoot({ envFilePath: ['.env.${NODE_ENV}', '.env'] })` 로 로드. 운영은 `NODE_ENV=production` → `.env.production` 사용.

## 변수 일람

### 런타임

| 키 | 필수 | 용도 |
|----|------|------|
| `NODE_ENV` | ✅ | `local` / `production` 분기 |
| `PORT` | (3000) | NestJS listen 포트 |

### 데이터베이스 (Supabase Postgres pooler)

| 키 | 필수 | 비고 |
|----|------|------|
| `DB_HOST` | ✅ | `aws-1-ap-northeast-2.pooler.supabase.com` |
| `DB_PORT` | ✅ | `6543` (transaction pooler) |
| `DB_USERNAME` | ✅ | `postgres.<project-ref>` |
| `DB_PASSWORD` | ✅ | |
| `DB_DATABASE` | ✅ | `postgres` |
| `DB_QUERY_LOG` | (선택) | `1` 이면 비-prod에서 query 로그 출력 |

### 인증 / 보안

| 키 | 용도 |
|----|------|
| `JWT_SECRET` | JWT 서명 키 |
| `JWT_EXPIRATION_TIME` | 액세스 토큰 만료 (예: `1d`) |
| `ADMIN_API_TOKEN` | 관리자 전용 엔드포인트 Bearer |
| `SWAGGER_ADMIN_USERNAME` / `SWAGGER_ADMIN_PASSWORD` | `/api-docs` Basic Auth (둘 다 있어야 Swagger 노출) |

### 소셜 로그인

각 프로바이더별로 표준 콜백 + PKCE 콜백 한 쌍:

| 키 | 비고 |
|----|------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | |
| `GOOGLE_CALLBACK_URL` / `GOOGLE_PKCE_CALLBACK_URL` | |
| `KAKAO_CLIENT_ID` / `KAKAO_CLIENT_SECRET` | |
| `KAKAO_CALLBACK_URL` / `KAKAO_PKCE_CALLBACK_URL` | |
| `KAKAO_MAP_API` | Kakao Map REST 키 (LocationModule) |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | |
| `NAVER_CALLBACK_URL` / `NAVER_PKCE_CALLBACK_URL` | |

### 외부 API / 서비스

| 키 | 용도 |
|----|------|
| `REDIS_HOST` / `REDIS_PORT` | 컨테이너 환경에선 `redis:6379` |
| `REDIS_PASSWORD` / `REDIS_DB` | (선택) |
| `GRAPHHOPPER_URL` | 컨테이너 환경에선 `http://graphhopper:8989` |
| `SEOUL_OPEN_API_KEY` | 따릉이 대여소 API 키 |
| `OPENAI_API_KEY` | (사용 모듈에서 호출 시) |
| `GOOGLE_APPLICATION_CREDENTIALS` | GCP 서비스 계정 키 JSON 경로 (`./ddareungimap-b829ea269d30.json`) |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | TTS Storage + 인증 |
| `MAIL_USER` / `MAIL_PASS` | Gmail SMTP (앱 비밀번호 권장) |
| `GA4_MEASUREMENT_ID` / `GA4_API_SECRET` | (선택) GA4 활성화 시 |
| `SENTRY_DSN` | production 에서만 활성화 |
| `SENTRY_TRACES_SAMPLE_RATE` | 기본 `0.1` |

## 컨테이너 환경 주의사항

호스트네임은 **반드시 docker compose 서비스명**으로 설정. 컨테이너 안에서 `localhost`는 자기 자신이라 다른 서비스에 닿지 않음.

```env
# compose 환경 (production)
REDIS_HOST=redis
GRAPHHOPPER_URL=http://graphhopper:8989

# 호스트 직접 실행 (로컬 개발)
REDIS_HOST=localhost
GRAPHHOPPER_URL=http://localhost:8989
```

`docker-compose.yml`이 `nestjs` 서비스의 `environment:`에서 `REDIS_HOST=redis`/`GRAPHHOPPER_URL=...`를 명시 주입하므로 `.env.production` 값이 잘못돼도 컨테이너에선 올바르게 동작. 단 호스트에서 직접 디버깅할 땐 `.env.production` 값이 그대로 적용됨.

## 시크릿 관리

- `.env.production` 은 git 추적 제외 (`.gitignore`).
- 빌드 컨텍스트에 들어가지 않음 (`.dockerignore`로 `.env*`, `*.pem`, GCP 키 JSON 차단).
- 컨테이너에는 런타임에 read-only 바인드 마운트로 주입:
  - `.env.production` → compose `env_file:` (자동)
  - `ddareungimap-b829ea269d30.json` → `/app/ddareungimap-b829ea269d30.json:ro`
- AWS 자격증명은 EC2 인스턴스 프로파일(`Ddareungimap_EC2_S3_Uploader`)로 자동 주입. `.env`에 저장 금지.
