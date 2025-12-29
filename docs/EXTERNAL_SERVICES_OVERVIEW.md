# 외부 서비스 통합 개요

DDareungiMap Backend는 다양한 외부 서비스와 통합되어 있습니다. 이 문서는 각 서비스의 역할과 설정 방법을 안내합니다.

## 📋 외부 서비스 목록

### 1. **Seoul Open API** (서울시 공공 데이터)

- **역할**: 따릉이 대여소 정보 및 실시간 자전거 현황 조회
- **사용 모듈**: `stations` 모듈
- **상세 문서**: [SEOUL_OPEN_API.md](./SEOUL_OPEN_API.md)

### 2. **GraphHopper** (경로 최적화)

- **역할**: 자전거 경로 계산 및 최적화
- **사용 모듈**: `routes` 모듈
- **상세 문서**: [GRAPHHOPPER_SETUP.md](./GRAPHHOPPER_SETUP.md)

### 3. **Redis** (캐싱 및 세션 관리)

- **역할**: 네비게이션 세션, TTS 캐시, 경로 데이터 저장
- **사용 모듈**: `navigation`, `tts`, `routes` 모듈
- **상세 문서**: [REDIS_SETUP.md](./REDIS_SETUP.md)

### 4. **Google Cloud TTS** (음성 합성)

- **역할**: 네비게이션 인스트럭션을 음성으로 변환
- **사용 모듈**: `tts` 모듈
- **상세 문서**: [TTS_SERVICE_SETUP.md](./TTS_SERVICE_SETUP.md)

### 5. **AWS S3** (TTS 오디오 파일 저장)

- **역할**: 합성된 TTS 오디오 파일 저장 및 배포
- **사용 모듈**: `tts` 모듈
- **상세 문서**: [AWS_S3_SETUP.md](./AWS_S3_SETUP.md)

### 6. **AWS Secrets Manager** (자격 증명 관리)

- **역할**: Google Cloud 서비스 계정 키 안전 보관
- **사용 모듈**: `tts` 모듈
- **상세 문서**: [AWS_SECRETS_MANAGER.md](./AWS_SECRETS_MANAGER.md)

## 🔧 환경별 설정

### 공통 설정 (`.env`)

```env
# 데이터베이스 (Supabase PostgreSQL)
DB_HOST=your-supabase-host.pooler.supabase.com
DB_PORT=6543
DB_USERNAME=postgres.xxxxxxxxx
DB_PASSWORD=your_secure_password
DB_DATABASE=postgres

# Seoul Open API
SEOUL_OPEN_API_KEY=your_seoul_api_key_here

# GraphHopper (EC2 서버)
GRAPHHOPPER_URL=http://your-server-ip:8989

# Redis (EC2 서버)
REDIS_HOST=your-redis-host
REDIS_PORT=6379
```

### 로컬 개발 환경 (`.env.local`)

```env
# Google Cloud TTS (로컬: 파일 경로)
GOOGLE_APPLICATION_CREDENTIALS=./your-service-account-key.json

# AWS S3 (로컬: IAM User Access Key 사용)
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=AKIA******************
AWS_SECRET_ACCESS_KEY=********************************
TTS_S3_BUCKET=ddareungimap-tts-cache
```

### EC2 프로덕션 환경 (`.env.production`)

```env
# Google Cloud TTS (EC2: AWS Secrets Manager에서 자동 로드)
GOOGLE_CREDENTIALS_SECRET_NAME=ddareungimap/googleCloud
AWS_REGION=ap-northeast-2

# AWS S3 (EC2: IAM Role로 자동 인증, Access Key 불필요)
TTS_S3_BUCKET=ddareungimap-tts-cache

# 참고: DB, Seoul API, GraphHopper, Redis는 .env 파일 사용
```

## 📊 서비스 의존성 다이어그램

```
┌─────────────────────────────────────────────────────┐
│                  Backend API Server                 │
│                   (NestJS on EC2)                   │
└─────────────────────────────────────────────────────┘
            │         │         │         │
            ▼         ▼         ▼         ▼
    ┌──────────┐ ┌────────┐ ┌───────┐ ┌──────────────┐
    │  Seoul   │ │GraphH. │ │ Redis │ │ Google Cloud │
    │ Open API │ │ Server │ │Server │ │     TTS      │
    └──────────┘ └────────┘ └───────┘ └──────────────┘
                                              │
                                              ▼
                                    ┌──────────────────┐
                                    │  AWS S3 Bucket   │
                                    │ (TTS MP3 Files)  │
                                    └──────────────────┘
                │                           │
                ▼                           ▼
    ┌───────────────────┐       ┌────────────────────┐
    │ AWS IAM Role      │       │ AWS Secrets Mgr    │
    │ (EC2 Permissions) │       │ (Google Creds)     │
    └───────────────────┘       └────────────────────┘
```

## 🚀 빠른 시작 가이드

### 1. 로컬 개발 환경 설정 (5-10분)

1. **Seoul Open API 키 발급**: [SEOUL_OPEN_API.md](./SEOUL_OPEN_API.md) 참고
2. **Redis 설치 및 실행**: `docker-compose up -d` 또는 로컬 설치
3. **GraphHopper 서버 실행**: [GRAPHHOPPER_SETUP.md](./GRAPHHOPPER_SETUP.md) 참고
4. **Google Cloud TTS 설정**: 서비스 계정 키 다운로드
5. **AWS 자격 증명 설정**: IAM 사용자 생성 및 Access Key 발급
6. `.env.local` 파일 생성 및 환경변수 설정

### 2. EC2 프로덕션 배포 (30-60분)

1. **EC2 인스턴스 설정**: [EC2_DEPLOYMENT.md](./EC2_DEPLOYMENT.md) 참고
2. **AWS IAM Role 설정**: S3 및 Secrets Manager 권한 추가
3. **AWS Secrets Manager**: Google 서비스 계정 키 업로드
4. **Redis 서버 설정**: EC2 또는 별도 서버에 설치
5. **GraphHopper 서버 설정**: EC2 또는 별도 서버에 설치
6. `.env.production` 파일 생성 및 환경변수 설정
7. GitHub Actions CI/CD 설정

## ⚠️ 주의사항

### 보안

- ✅ **로컬**: 서비스 계정 키 파일을 `.gitignore`에 추가
- ✅ **EC2**: AWS Secrets Manager 사용, Access Key 환경변수 사용 금지
- ✅ **S3 버킷**: 공개 읽기만 허용, 쓰기는 IAM Role로 제한

### 비용 관리

- **Google Cloud TTS**: $4 per 1 million characters (무료 티어: 월 100만 문자)
- **AWS S3**: 스토리지 $0.023 per GB, 요청 $0.005 per 1,000 GET
- **AWS Secrets Manager**: $0.40 per secret per month
- **EC2 인스턴스**: t2.micro (프리 티어) 또는 t3.small 권장

### 성능 최적화

- **Redis TTL**: TTS 캐시 30일, 네비게이션 세션 10분
- **S3 CDN**: CloudFront 연동 고려 (옵션)
- **GraphHopper**: 메모리 3GB 이상 권장

## 📚 추가 문서

- [TTS 기능 구현 가이드](../TTS_IMPLEMENTATION.md)
- [환경 설정 가이드](../ENVIRONMENT_GUIDE.md)
- [이메일 인증 기능 가이드](../FEATURE_GUIDE_EMAIL_VERIFICATION.md)

## 🆘 트러블슈팅

각 서비스별 상세 문서의 트러블슈팅 섹션을 참고하세요:

- Seoul Open API: 429 Too Many Requests
- GraphHopper: 메모리 부족, 경로 계산 실패
- Redis: 연결 거부, 메모리 초과
- Google TTS: 인증 실패, API 할당량 초과
- AWS S3: Access Denied, 버킷 정책 오류
- AWS Secrets Manager: ResourceNotFoundException

## 📞 지원

문제가 발생하면 다음을 확인하세요:

1. 환경변수가 올바르게 설정되었는지 확인
2. 각 서비스가 정상적으로 실행 중인지 확인
3. PM2 로그 확인: `pm2 logs ddareungimap-api`
4. 각 서비스별 상세 문서의 트러블슈팅 섹션 참고
