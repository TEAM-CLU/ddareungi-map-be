# 환경별 설정 가이드

## 🌍 환경별 실행 방법

### 로컬 개발 환경

```bash
# 로컬 환경으로 개발 서버 실행
pnpm run start:local

# 또는
NODE_ENV=local pnpm run start:dev
```

### 프로덕션 환경

```bash
# 프로덕션 환경으로 실행
pnpm run start:production

# 또는
NODE_ENV=production pnpm run start:prod
```

## 📁 환경 파일 구조

```
.env.local          # 로컬 개발용 (gitignore)
.env.production     # 프로덕션용 (gitignore)
.env               # 기본 설정 (공통)
```

## ⚙️ 환경별 주요 차이점

| 설정             | 로컬                     | 프로덕션                      |
| ---------------- | ------------------------ | ----------------------------- |
| BASE_URL         | http://localhost:3000    | https://production-domain.com |
| DB_HOST          | localhost                | 프로덕션 DB 호스트            |
| 소셜 로그인 콜백 | localhost:3000/auth/...  | 프로덕션 도메인/auth/...      |
| CORS_ORIGINS     | localhost:3000,3001,8080 | 실제 프론트엔드 도메인들      |

## 🔧 로컬 개발 환경 설정

1. `.env` 파일에 공통 설정 (DB, Redis, GraphHopper, Seoul API)
2. `.env.local` 파일에 TTS 관련 설정

### `.env` (공통 설정)

```env
# 데이터베이스 (PostgreSQL)
DB_HOST=your-db-host.com
DB_PORT=5432
DB_USERNAME=your_username
DB_PASSWORD=your_secure_password
DB_DATABASE=your_database

# Seoul Open API
SEOUL_OPEN_API_KEY=your_seoul_api_key

# GraphHopper 서버
GRAPHHOPPER_URL=http://your-server-ip:8989

# Redis 서버
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password  # 선택사항
```

### `.env.local` (로컬 TTS 설정)

```env
# Google Cloud TTS (로컬: 파일 경로)
GOOGLE_APPLICATION_CREDENTIALS=./your-service-account-key.json

# AWS S3 (로컬: IAM User Access Key)
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=AKIA******************
AWS_SECRET_ACCESS_KEY=********************************
TTS_S3_BUCKET=your-tts-bucket-name
```

3. 로컬 서버 실행:
   ```bash
   pnpm run start:local
   ```

## 📡 Sentry (에러 모니터링) 설정

운영 환경(production)에서 발생하는 런타임 에러를 Sentry로 전송하여 실시간으로 감지하고,
Stack Trace 및 Trace ID 등 컨텍스트 정보를 기반으로 장애 대응 속도를 높입니다.

### 필수/선택 환경변수

```env
# production 환경에서만 전송됩니다. (NODE_ENV=production)
SENTRY_DSN=your_sentry_dsn

# 성능 모니터링(Tracing) 샘플링 비율 (기본값: 0.1)
SENTRY_TRACES_SAMPLE_RATE=0.1
```

### 테스트 방법

- `GET /test/sentry-error` 호출 시 의도적으로 에러를 발생시킵니다.
- production 환경에서 호출하면 Sentry 대시보드에 에러가 유입되는지 확인할 수 있습니다.

## 📘 Swagger 관리자 접근 설정

Swagger 문서는 기본 공개가 아니라, 전용 관리자 계정이 설정된 경우에만 활성화됩니다.

### 보호 대상 경로

- `/api-docs`
- `/api-docs-json`

### 필수 환경변수

```env
SWAGGER_ADMIN_USERNAME=admin
SWAGGER_ADMIN_PASSWORD=change-this-password
```

### 동작 방식

- 두 값이 모두 설정되어 있으면 Swagger UI와 OpenAPI JSON에 Basic Auth가 적용됩니다.
- 인증에 성공한 경우에만 Swagger UI와 JSON 스펙을 볼 수 있습니다.
- 둘 중 하나라도 빠져 있으면 Swagger는 아예 비활성화됩니다.

### 접근 예시

브라우저로 `/api-docs`에 접근하면 Basic Auth 로그인 창이 표시됩니다.

## �️ TTS (Text-to-Speech) 설정

네비게이션 인스트럭션을 음성으로 변환하여 S3에 캐싱하는 기능입니다.

### 저장 정책 (Redis / S3)

- **Redis (임시 TTS 캐시)**: 3일 TTL (자동 만료)
- **Redis (고정 메시지 캐시)**: 10년 TTL (사실상 영구)
- **S3 (오디오 파일)**: 서버 코드에서는 삭제하지 않으며, **S3 Lifecycle 정책으로 관리**합니다.
  - 저장 경로를 분리하여 Lifecycle을 각각 적용합니다:
    - `tts/temp/` : **30일 후 Expiration(삭제)** 권장
    - `tts/permanent/` : 장기 보관(만료 없음) 또는 별도 정책 권장

### 필수 환경변수

```env
# 로컬 개발 환경 (.env.local)
# ====================================
# Google Cloud TTS 서비스 계정 키 파일 경로
GOOGLE_APPLICATION_CREDENTIALS=./your-service-account-key.json

# AWS S3 자격 증명 (로컬 개발용 IAM User)
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=AKIA******************
AWS_SECRET_ACCESS_KEY=********************************
TTS_S3_BUCKET=ddareungimap-tts-cache


# EC2 배포 환경 (.env.production)
# ====================================
# Google Cloud TTS (프로덕션: 파일 경로)
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account-key.json

# AWS 설정: EC2 IAM Role 사용 (자동 인증)
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY 설정 불필요
AWS_REGION=ap-northeast-2
TTS_S3_BUCKET=ddareungimap-tts-cache
```

> 📝 **구성 가이드**:
>
> - Google Cloud에서 TTS API 활성화 및 서비스 계정 생성
> - AWS S3 버킷 생성 (전역 고유 이름 사용)
> - 프로덕션 환경에서도 서비스 계정 키 파일을 안전하게 배포하고 `GOOGLE_APPLICATION_CREDENTIALS`로 경로 지정
> - 음성: ko-KR-Wavenet-A (한국어 여성) 권장

### Google Cloud TTS 설정 방법

1. **Google Cloud Console에서 프로젝트 생성**
   - https://console.cloud.google.com 접속
   - 새 프로젝트 생성 또는 기존 프로젝트 선택

2. **Text-to-Speech API 활성화**
   - API 및 서비스 > 라이브러리
   - "Cloud Text-to-Speech API" 검색 후 활성화

3. **서비스 계정 생성**
   - IAM 및 관리자 > 서비스 계정
   - 서비스 계정 생성
   - 역할: "Cloud Text-to-Speech 사용자" 권한 부여
   - JSON 키 파일 다운로드

4. **환경변수 설정**

   **로컬 개발 환경 (.env.local):**

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account-key.json
   ```

   **EC2 배포 환경 (.env.production):**

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account-key.json
   ```

### AWS S3 설정 방법

1. **S3 버킷 생성**
   - AWS Console > S3
   - 버킷 생성: 전역적으로 고유한 이름 사용 (예: `myproject-tts-cache`)
   - 리전: `ap-northeast-2` (서울) 권장
   - 퍼블릭 액세스 차단 해제 (공개 읽기용)

2. **버킷 정책 설정** (공개 읽기)

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "PublicReadGetObject",
         "Effect": "Allow",
         "Principal": "*",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::ddareungimap-tts-cache/tts/*"
       }
     ]
   }
   ```

3. **IAM 권한 설정**

   **로컬 개발 환경:**
   - IAM 사용자 생성 후 Access Key 발급
   - `.env.local`에 `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` 설정
   - 필요한 권한:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject"],
         "Resource": "arn:aws:s3:::your-tts-bucket-name/tts/*"
       }
     ]
   }
   ```

   **EC2 배포 환경:**
   - EC2 인스턴스에 IAM Role 연결 (이미 설정됨)
   - `.env.production`에 자격 증명 불필요
   - IAM Role에 S3 권한 포함되어 있음

### TTS 동작 방식

1. 사용자가 네비게이션 세션 시작
2. 인스트럭션 텍스트를 한글로 번역
3. Google Cloud TTS로 음성 합성
4. S3에 MP3 파일 업로드
5. Redis에 캐시 (텍스트 -> S3 URL 매핑)
6. 클라이언트에 `ttsUrl` 필드 포함하여 응답

### 응답 예시

```json
{
  "sessionId": "uuid-session-id",
  "instructions": [
    {
      "text": "Continue for 150 meters",
      "textKo": "150미터 직진하세요",
      "ttsUrl": "https://your-bucket.s3.ap-northeast-2.amazonaws.com/tts/ko-KR/abc123def.mp3",
      "distance": 150,
      "time": 30,
      "sign": 0,
      "interval": [0, 10]
    }
  ]
}
```

### 비용 최적화

- **Redis TTL**: 30일 (자동 삭제)
- **S3 수명 주기**: 90일 후 자동 삭제 권장
- **캐시 히트**: 동일 텍스트는 재사용

## �🌐 PKCE 로그인 테스트

### 로컬에서 테스트:

```javascript
// 1. PKCE URL 받기
fetch('http://localhost:3000/auth/google/pkce')
  .then((res) => res.json())
  .then((data) => {
    sessionStorage.setItem('code_verifier', data.codeVerifier);
    sessionStorage.setItem('state', data.state);
    window.location.href = data.authUrl;
  });

// 2. 콜백 처리 (콜백 페이지에서)
const code = new URLSearchParams(window.location.search).get('code');
const state = new URLSearchParams(window.location.search).get('state');
const codeVerifier = sessionStorage.getItem('code_verifier');

fetch(
  `http://localhost:3000/auth/google/pkce/callback?code=${code}&code_verifier=${codeVerifier}&state=${state}`,
)
  .then((res) => res.json())
  .then((result) => console.log('로그인 결과:', result));
```

## 🚀 배포 시 주의사항

1. **환경변수 검증**: 모든 필수 환경변수가 설정되었는지 확인
2. **소셜 로그인 콜백 URL**: 각 플랫폼에서 올바른 콜백 URL 등록
3. **CORS 설정**: 프론트엔드 도메인이 CORS_ORIGINS에 포함되었는지 확인
4. **데이터베이스 연결**: 프로덕션 DB 접속 정보 확인

## 🔍 트러블슈팅

### "환경변수가 설정되지 않았습니다" 에러

- 해당 환경의 .env 파일에 필요한 변수가 있는지 확인
- NODE_ENV가 올바르게 설정되었는지 확인

### 소셜 로그인 콜백 에러

- 각 플랫폼의 개발자 콘솔에서 콜백 URL이 올바르게 등록되었는지 확인
- 로컬/프로덕션 환경에 맞는 URL인지 확인

### CORS 에러

- CORS_ORIGINS 환경변수에 프론트엔드 도메인이 포함되었는지 확인
