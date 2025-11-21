# AWS S3 설정 가이드

TTS 오디오 파일 저장 및 배포를 위한 AWS S3 버킷 설정 가이드입니다.

## 📋 개요

- **제공**: Amazon S3 (Simple Storage Service)
- **용도**: TTS MP3 파일 저장 및 공개 URL 제공
- **접근**: 공개 읽기, IAM Role 쓰기
- **사용 모듈**: `src/tts/` 모듈

## 🏗️ 아키텍처

```
TTS Service
      │
      ▼
MP3 Buffer
      │
      ▼
S3 PutObject (IAM Role 인증)
      │
      ▼
s3://ddareungimap-tts-cache/tts/ko-KR/abc123.mp3
      │
      ▼
Public URL
https://ddareungimap-tts-cache.s3.amazonaws.com/tts/ko-KR/abc123.mp3
      │
      ▼
Frontend Audio Player
```

## 📦 S3 버킷 생성

### 1. AWS Console에서 생성

1. [AWS S3 Console](https://s3.console.aws.amazon.com) 접속
2. **버킷 만들기** 클릭
3. **일반 구성**:
   - 버킷 이름: `ddareungimap-tts-cache` (전역 고유)
   - AWS 리전: `아시아 태평양 (서울) ap-northeast-2`
4. **객체 소유권**:
   - ACL 비활성화됨 (권장) 선택
5. **이 버킷의 퍼블릭 액세스 차단 설정**:
   - ✅ **모든 퍼블릭 액세스 차단 해제** (공개 읽기 허용)
   - ⚠️ 경고 메시지 확인
6. **버킷 버전 관리**: 비활성화 (선택 사항)
7. **태그**: `Environment=Production`, `Service=TTS`
8. **기본 암호화**: 서버 측 암호화 비활성화 (공개 파일이므로 불필요)
9. **버킷 만들기** 클릭

### 2. AWS CLI로 생성

```bash
# 버킷 생성
aws s3 mb s3://ddareungimap-tts-cache --region ap-northeast-2

# 퍼블릭 액세스 차단 해제
aws s3api delete-public-access-block \
  --bucket ddareungimap-tts-cache
```

## 🔐 버킷 정책 설정

### 1. 공개 읽기 정책

AWS Console > S3 > 버킷 선택 > **권한** 탭 > **버킷 정책** 편집:

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

**설명**:
- `Principal: "*"`: 모든 사용자
- `Action: s3:GetObject`: 읽기만 허용
- `Resource: .../tts/*`: `/tts/` 폴더 내 파일만 공개

### 2. AWS CLI로 정책 설정

```bash
# policy.json 파일 생성
cat > policy.json << 'EOF'
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
EOF

# 버킷 정책 적용
aws s3api put-bucket-policy \
  --bucket ddareungimap-tts-cache \
  --policy file://policy.json
```

## 🔧 CORS 설정

프론트엔드에서 오디오 파일 재생을 위한 CORS 설정:

### AWS Console에서 설정

AWS Console > S3 > 버킷 선택 > **권한** 탭 > **CORS(Cross-origin 리소스 공유)** 편집:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

### AWS CLI로 설정

```bash
cat > cors.json << 'EOF'
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedOrigins": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
EOF

aws s3api put-bucket-cors \
  --bucket ddareungimap-tts-cache \
  --cors-configuration file://cors.json
```

## 🔑 IAM 권한 설정

### 로컬 개발: IAM 사용자

1. [IAM Console](https://console.aws.amazon.com/iam) 접속
2. **사용자** > **사용자 추가**
3. 사용자 이름: `ddareungi-tts-local`
4. **프로그래매틱 액세스** 선택
5. **권한 설정**: **기존 정책 직접 연결**
6. 정책 생성:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::ddareungimap-tts-cache/tts/*"
    }
  ]
}
```

7. **사용자 만들기** 클릭
8. **액세스 키 ID**와 **비밀 액세스 키** 저장

### EC2 프로덕션: IAM Role

1. [IAM Console](https://console.aws.amazon.com/iam) > **역할** > **역할 만들기**
2. **신뢰할 수 있는 엔터티 유형**: AWS 서비스
3. **사용 사례**: EC2
4. **권한 추가**: 정책 생성

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3TtsAccess",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::ddareungimap-tts-cache/tts/*"
    },
    {
      "Sid": "SecretsManagerAccess",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:ap-northeast-2:*:secret:ddareungimap/googleCloud-*"
    }
  ]
}
```

5. 역할 이름: `ddareungi-map-ec2-role`
6. **역할 만들기** 클릭

### EC2 인스턴스에 IAM Role 연결

1. EC2 Console > 인스턴스 선택
2. **작업** > **보안** > **IAM 역할 수정**
3. 생성한 IAM Role 선택
4. **IAM 역할 업데이트** 클릭
5. EC2 재부팅 불필요 (즉시 적용)

## ⚙️ 환경 설정

### 로컬 개발 환경 (`.env.local`)

```env
# AWS S3 (로컬: IAM User Access Key)
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=AKIA******************
AWS_SECRET_ACCESS_KEY=********************************
TTS_S3_BUCKET=ddareungimap-tts-cache
```

### EC2 프로덕션 환경 (`.env.production`)

```env
# AWS S3 (EC2: IAM Role로 자동 인증)
AWS_REGION=ap-northeast-2
TTS_S3_BUCKET=ddareungimap-tts-cache
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY 불필요 (IAM Role 사용)
```

> 📝 **구성**:
> - 버킷 이름: 전역적으로 고유한 이름 사용
> - 리전: `ap-northeast-2` (서울) 권장
> - 공개 URL: `https://{bucket-name}.s3.{region}.amazonaws.com/tts/ko-KR/{hash}.mp3`
> - IAM User (로컬): Access Key 발급
> - IAM Role (EC2): EC2 인스턴스에 연결

## 💻 코드 구현

### TtsService에서 S3 업로드

**위치**: `src/tts/tts.service.ts`

```typescript
import { S3 } from 'aws-sdk';

@Injectable()
export class TtsService {
  private s3: S3;

  constructor(private readonly configService: ConfigService) {
    const awsRegion = this.configService.get<string>('AWS_REGION') || 'ap-northeast-2';
    const awsAccessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const awsSecretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

    if (awsAccessKeyId && awsSecretAccessKey) {
      // 로컬: Access Key 사용
      this.s3 = new S3({
        region: awsRegion,
        credentials: {
          accessKeyId: awsAccessKeyId,
          secretAccessKey: awsSecretAccessKey,
        },
      });
      this.logger.log('AWS S3 initialized with Access Key (Local)');
    } else {
      // EC2: IAM Role 사용
      this.s3 = new S3({ region: awsRegion });
      this.logger.log('AWS S3 initialized with IAM Role (EC2)');
    }
  }

  async uploadToS3(audioBuffer: Buffer, hash: string, lang: string): Promise<string> {
    const bucket = this.configService.get<string>('TTS_S3_BUCKET');
    const key = `tts/${lang}/${hash}.mp3`;

    await this.s3.putObject({
      Bucket: bucket,
      Key: key,
      Body: audioBuffer,
      ContentType: 'audio/mpeg',
    }).promise();

    return `https://${bucket}.s3.amazonaws.com/${key}`;
  }
}
```

## 🧪 테스트

### AWS CLI로 업로드 테스트

```bash
# 테스트 파일 생성
echo "Test audio" > test.mp3

# S3 업로드
aws s3 cp test.mp3 s3://ddareungimap-tts-cache/tts/test/test.mp3 \
  --region ap-northeast-2

# 업로드 확인
aws s3 ls s3://ddareungimap-tts-cache/tts/test/

# 공개 URL 접근 테스트
curl -I https://ddareungimap-tts-cache.s3.amazonaws.com/tts/test/test.mp3
# HTTP/1.1 200 OK
```

### 애플리케이션 테스트

```bash
# TTS 생성 (자동으로 S3 업로드)
curl -X POST "http://localhost:3000/tts/test" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "테스트 음성입니다",
    "lang": "ko-KR"
  }'

# 응답에서 S3 URL 확인
{
  "status": "ready",
  "url": "https://ddareungimap-tts-cache.s3.amazonaws.com/tts/ko-KR/abc123.mp3"
}

# 브라우저나 curl로 URL 접근 테스트
curl -I <S3_URL>
```

### S3 버킷 내용 확인

```bash
# 모든 파일 목록
aws s3 ls s3://ddareungimap-tts-cache/tts/ --recursive

# 한국어 TTS 파일만
aws s3 ls s3://ddareungimap-tts-cache/tts/ko-KR/

# 파일 개수 및 크기
aws s3 ls s3://ddareungimap-tts-cache/tts/ --recursive --summarize
```

## ⚠️ 트러블슈팅

### 1. Access Denied (업로드 실패)

**증상**:
```
AccessDenied: Access Denied
```

**로컬 해결**:
1. IAM 사용자 권한 확인 (s3:PutObject)
2. `.env.local`에서 Access Key 확인
3. 버킷 이름 확인 (`TTS_S3_BUCKET`)

**EC2 해결**:
1. EC2 IAM Role 권한 확인
2. IAM Role이 EC2에 연결되어 있는지 확인
3. EC2 메타데이터 서비스 확인:
```bash
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/
```

### 2. 공개 URL 접근 불가 (403 Forbidden)

**증상**:
```
curl -I https://ddareungimap-tts-cache.s3.amazonaws.com/tts/ko-KR/abc123.mp3
HTTP/1.1 403 Forbidden
```

**해결**:
1. 버킷 정책 확인 (공개 읽기 허용)
2. 퍼블릭 액세스 차단 해제 확인
3. 파일 경로 확인 (`/tts/` 폴더 내에 있어야 함)
4. 버킷 정책 재적용:
```bash
aws s3api put-bucket-policy --bucket ddareungimap-tts-cache --policy file://policy.json
```

### 3. CORS 에러 (프론트엔드)

**증상**:
```
Access to audio at 'https://...' from origin 'http://localhost:3000' has been blocked by CORS policy
```

**해결**:
1. CORS 설정 확인
2. CORS 재적용:
```bash
aws s3api put-bucket-cors --bucket ddareungimap-tts-cache --cors-configuration file://cors.json
```

3. 브라우저 캐시 삭제 및 재시도

### 4. 버킷이 존재하지 않음

**증상**:
```
NoSuchBucket: The specified bucket does not exist
```

**해결**:
1. 버킷 이름 확인 (오타)
2. 리전 확인 (ap-northeast-2)
3. 버킷 생성 확인:
```bash
aws s3 ls
```

## 📊 비용 관리

### S3 요금

**스토리지**:
- $0.023 per GB / 월 (첫 50TB)
- 예상: 10,000 파일 * 20KB = 200MB → $0.005/월

**요청**:
- PUT: $0.005 per 1,000 requests
- GET: $0.0004 per 1,000 requests
- 예상: 10,000 PUT + 100,000 GET → $0.09/월

**데이터 전송**:
- 아웃바운드: $0.126 per GB (첫 10TB)
- 예상: 100,000 재생 * 20KB = 2GB → $0.25/월

**월간 예상 비용**: $0.35 ~ $1

### 비용 절감 팁

1. **수명 주기 정책**: 90일 이상 액세스되지 않은 파일 삭제
```json
{
  "Rules": [
    {
      "Id": "Delete old TTS files",
      "Status": "Enabled",
      "Filter": { "Prefix": "tts/" },
      "Expiration": { "Days": 90 }
    }
  ]
}
```

2. **CloudFront CDN**: 글로벌 배포 시 데이터 전송 비용 절감

3. **압축**: MP3 비트레이트 조정 (128kbps → 64kbps)

## 📈 성능 최적화

### 1. CloudFront CDN (선택 사항)

```bash
# CloudFront 배포 생성
aws cloudfront create-distribution \
  --origin-domain-name ddareungimap-tts-cache.s3.amazonaws.com \
  --default-root-object index.html
```

**장점**:
- 전 세계 엣지 로케이션에서 캐싱
- 빠른 로드 시간
- 데이터 전송 비용 절감

### 2. S3 Transfer Acceleration (선택 사항)

```bash
# Transfer Acceleration 활성화
aws s3api put-bucket-accelerate-configuration \
  --bucket ddareungimap-tts-cache \
  --accelerate-configuration Status=Enabled
```

**장점**:
- 업로드 속도 50-500% 향상
- 글로벌 엣지 로케이션 활용

### 3. Multipart Upload (대용량 파일)

```typescript
// 5MB 이상 파일
const upload = new AWS.S3.ManagedUpload({
  params: { Bucket, Key, Body },
});

await upload.promise();
```

## 🔍 모니터링

### CloudWatch 메트릭

1. AWS Console > CloudWatch > 메트릭 > S3
2. 주요 메트릭:
   - `NumberOfObjects`: 객체 수
   - `BucketSizeBytes`: 버킷 크기
   - `AllRequests`: 전체 요청 수
   - `4xxErrors`, `5xxErrors`: 에러 수

### S3 액세스 로그

```bash
# 로깅 활성화
aws s3api put-bucket-logging \
  --bucket ddareungimap-tts-cache \
  --bucket-logging-status '{
    "LoggingEnabled": {
      "TargetBucket": "ddareungimap-logs",
      "TargetPrefix": "s3-access-logs/"
    }
  }'
```

### 비용 알림

1. AWS Console > Billing > Budgets
2. **예산 생성**
3. 예산 금액: $5/월
4. 알림 임계값: 80%, 100%
5. 이메일 알림 설정

## 📚 참고 자료

- [AWS S3 공식 문서](https://docs.aws.amazon.com/s3/)
- [S3 버킷 정책 예제](https://docs.aws.amazon.com/AmazonS3/latest/userguide/example-bucket-policies.html)
- [S3 요금 계산기](https://calculator.aws/)
- [AWS SDK for JavaScript v2 - S3](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html)
