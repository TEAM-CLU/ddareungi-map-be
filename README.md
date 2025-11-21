# DDareungiMap Backend

서울시 따릉이(공공자전거) 대여소 정보 제공 및 실시간 네비게이션 서비스를 위한 NestJS 기반 백엔드 API입니다.

## 📋 주요 기능

- 🚲 **따릉이 대여소 정보**: 서울시 공공자전거 대여소 위치 및 실시간 자전거 현황 조회
- 🗺️ **경로 최적화**: GraphHopper 기반 자전거 경로 계산 및 최적화
- 🧭 **실시간 네비게이션**: Redis 기반 세션 관리로 실시간 경로 안내
- 🔊 **음성 안내**: Google Cloud TTS를 활용한 턴바이턴 음성 네비게이션
- 🔐 **소셜 로그인**: Google, Kakao, Naver OAuth 2.0 인증
- 📧 **이메일 인증**: 회원가입 및 비밀번호 찾기 기능
- 📊 **통계**: 사용자 경로 기록 및 통계 제공

## 🏗️ 기술 스택

- **Framework**: NestJS 10.x (TypeScript)
- **Database**: PostgreSQL with PostGIS (Supabase 호스팅)
- **Caching**: Redis (EC2)
- **Storage**: AWS S3 (TTS 오디오 파일)
- **Authentication**: JWT, OAuth 2.0
- **External APIs**: 
  - Seoul Open API (따릉이 데이터)
  - GraphHopper (경로 계산)
  - Google Cloud TTS (음성 합성)
- **Deployment**: EC2 with PM2

## 🚀 빠른 시작

### 사전 요구사항

- Node.js 18+ 
- pnpm 8+
- 외부 서비스 설정 필요:
  - PostgreSQL 데이터베이스
  - Redis 서버
  - GraphHopper 서버

### 설치

```bash
# 의존성 설치
pnpm install

# 환경 변수 설정
# .env 파일과 .env.local 파일을 생성하고 필요한 값 설정
# (상세 내용은 ENVIRONMENT_GUIDE.md 참고)
```

### 환경 설정

**`.env` (공통 설정)**
```env
DB_HOST=your-db-host
DB_PORT=5432
DB_DATABASE=your-database
SEOUL_OPEN_API_KEY=your_seoul_api_key
GRAPHHOPPER_URL=http://your-graphhopper-server:8989
REDIS_HOST=your-redis-host
REDIS_PORT=6379
```

**`.env.local` (로컬 개발용 TTS)**
```env
GOOGLE_APPLICATION_CREDENTIALS=./your-service-account-key.json
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=AKIA******************
AWS_SECRET_ACCESS_KEY=********************************
TTS_S3_BUCKET=ddareungimap-tts-cache
```

### 실행

```bash
# 로컬 개발 환경 (hot-reload)
pnpm run start:local

# 프로덕션 모드
pnpm run start:production

# 빌드
pnpm run build
```

### 테스트

```bash
# 유닛 테스트
pnpm run test

# E2E 테스트
pnpm run test:e2e

# 테스트 커버리지
pnpm run test:cov
```

## 📁 프로젝트 구조

```
src/
├── auth/                 # 인증 (OAuth, JWT)
├── common/              # 공통 DTO, 서비스 (API 응답, 암호화)
├── mail/                # 이메일 발송
├── navigation/          # 실시간 네비게이션 세션 관리
├── routes/              # 경로 계산 및 최적화
├── stations/            # 따릉이 대여소 정보
├── tts/                 # 음성 합성 (Google Cloud TTS)
└── user/                # 사용자 관리 및 통계

docs/                    # 외부 서비스 설정 문서
├── EXTERNAL_SERVICES_OVERVIEW.md
├── SEOUL_OPEN_API.md
├── GRAPHHOPPER_SETUP.md
├── REDIS_SETUP.md
├── TTS_SERVICE_SETUP.md
├── AWS_S3_SETUP.md
└── AWS_SECRETS_MANAGER.md
```

## 📚 문서

- **[환경 설정 가이드](./ENVIRONMENT_GUIDE.md)**: 로컬 및 프로덕션 환경 설정
- **[외부 서비스 통합](./docs/EXTERNAL_SERVICES_OVERVIEW.md)**: 모든 외부 서비스 설정 가이드
- **[이메일 인증 기능](./FEATURE_GUIDE_EMAIL_VERIFICATION.md)**: 이메일 인증 플로우
- **[TTS 구현](./TTS_IMPLEMENTATION.md)**: 음성 안내 구현 상세

## 🌐 외부 서비스

| 서비스 | 용도 | 설정 문서 |
|--------|------|-----------||
| **Supabase PostgreSQL** | 메인 DB (PostGIS) | [환경 설정](./ENVIRONMENT_GUIDE.md) |
| **Seoul Open API** | 따릉이 데이터 | [SEOUL_OPEN_API.md](./docs/SEOUL_OPEN_API.md) |
| **GraphHopper** | 경로 계산 | [GRAPHHOPPER_SETUP.md](./docs/GRAPHHOPPER_SETUP.md) |
| **Redis** | 캐싱 & 세션 | [REDIS_SETUP.md](./docs/REDIS_SETUP.md) |
| **Google Cloud TTS** | 음성 합성 | [TTS_SERVICE_SETUP.md](./docs/TTS_SERVICE_SETUP.md) |
| **AWS S3** | TTS 오디오 저장 | [AWS_S3_SETUP.md](./docs/AWS_S3_SETUP.md) |
| **AWS Secrets Manager** | 보안 키 관리 | [AWS_SECRETS_MANAGER.md](./docs/AWS_SECRETS_MANAGER.md) |

## 🚀 배포

**EC2 배포**:
- Process Manager: PM2
- 환경: `.env.production`

**EC2 배포 절차**:
```bash
# EC2 접속
ssh -i ~/.ssh/your-key.pem ubuntu@your-server-ip

# 코드 업데이트
cd /path/to/your/project
git pull origin main

# 빌드 및 재시작
pnpm install
pnpm run build
pm2 restart ddareungimap-api

# 로그 확인
pm2 logs ddareungimap-api
```

## 🔐 보안 주의사항

- ⚠️ `.env`, `.env.local`, `.env.production` 파일은 Git에 커밋하지 마세요
- ⚠️ Google 서비스 계정 키 파일(`.json`)은 Git에 커밋하지 마세요
- ⚠️ AWS Access Key는 안전하게 보관하세요
- ✅ EC2에서는 IAM Role 사용 (Access Key 불필요)
- ✅ Google 키는 AWS Secrets Manager에 저장 (EC2)
