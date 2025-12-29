# AWS Secrets Manager 설정 가이드

Google Cloud 서비스 계정 키를 안전하게 저장하고 관리하기 위한 AWS Secrets Manager 설정 가이드입니다.

## 📋 개요

- **제공**: AWS Secrets Manager
- **용도**: Google Cloud TTS 서비스 계정 키 안전 보관
- **접근**: EC2 IAM Role
- **사용 모듈**: `src/tts/` 모듈

## 🏗️ 아키텍처

```
Google Cloud Service Account Key (JSON)
      │
      ▼
AWS Secrets Manager
 (ddareungimap/googleCloud)
      │
      ▼
EC2 IAM Role (GetSecretValue)
      │
      ▼
TtsProvider (onModuleInit)
      │
      ▼
Temporary File (/tmp/google-credentials-*.json)
      │
      ▼
Google TTS Client Initialized
```

## 🔑 시크릿 생성

### 방법 1: AWS Console

1. [AWS Secrets Manager Console](https://console.aws.amazon.com/secretsmanager) 접속
2. **새 보안 암호 저장** 클릭
3. **보안 암호 유형 선택**:
   - **다른 유형의 보안 암호** 선택
4. **키/값 쌍** 탭에서 **일반 텍스트** 탭으로 전환
5. Google 서비스 계정 JSON 파일 내용 전체 붙여넣기:
```json
{
  "type": "service_account",
  "project_id": "ethereal-entity-478102-d0",
  "private_key_id": "d2603a45e6e9...",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n",
  "client_email": "ddareungi-tts@ethereal-entity-478102-d0.iam.gserviceaccount.com",
  "client_id": "1234567890",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://..."
}
```

6. **다음** 클릭
7. **보안 암호 구성**:
   - 보안 암호 이름: `ddareungimap/googleCloud`
   - 설명: `Google Cloud TTS Service Account Key`
   - 태그: `Environment=Production`, `Service=TTS`
8. **보안 암호 교체 구성**: 교체 비활성화 (수동 관리)
9. **다음** > **저장** 클릭

### 방법 2: AWS CLI (로컬에서)

```bash
# 서비스 계정 JSON 파일을 시크릿으로 저장
aws secretsmanager create-secret \
  --name ddareungimap/googleCloud \
  --description "Google Cloud TTS Service Account Key for DDareungi Map" \
  --secret-string file://ethereal-entity-478102-d0-d2603a45e6e9.json \
  --region ap-northeast-2 \
  --tags Key=Environment,Value=Production Key=Service,Value=TTS

# 성공 응답
{
    "ARN": "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:ddareungimap/googleCloud-AbCdEf",
    "Name": "ddareungimap/googleCloud",
    "VersionId": "..."
}
```

## 🔐 IAM 권한 설정

### EC2 IAM Role에 권한 추가

1. [IAM Console](https://console.aws.amazon.com/iam) > **역할**
2. EC2 인스턴스에 연결된 역할 선택 (예: `ddareungi-map-ec2-role`)
3. **권한 추가** > **인라인 정책 생성**
4. JSON 편집기에 다음 정책 입력:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SecretsManagerGetSecret",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:ap-northeast-2:*:secret:ddareungimap/googleCloud-*"
    }
  ]
}
```

5. 정책 이름: `SecretsManagerReadGoogleCloudCredentials`
6. **정책 생성** 클릭

### AWS CLI로 권한 추가

```bash
# 정책 문서 생성
cat > secrets-manager-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:ap-northeast-2:*:secret:ddareungimap/googleCloud-*"
    }
  ]
}
EOF

# IAM Role에 인라인 정책 추가
aws iam put-role-policy \
  --role-name ddareungi-map-ec2-role \
  --policy-name SecretsManagerReadGoogleCloudCredentials \
  --policy-document file://secrets-manager-policy.json
```

## ⚙️ 환경 설정

### EC2 프로덕션 환경 (`.env.production`)

```env
# Google Cloud TTS (EC2: AWS Secrets Manager에서 자동 로드)
GOOGLE_CREDENTIALS_SECRET_NAME=your-project/googleCloud
AWS_REGION=ap-northeast-2
```

> 📝 **구성**:
> - 시크릿 이름: 프로젝트에 맞는 이름 사용 (예: `myproject/googleCloud`)
> - 리전: `ap-northeast-2` (서울) 또는 EC2와 동일 리전
> - 시크릿 내용: Google 서비스 계정 JSON 키 전체

> ⚠️ **중요**: 로컬 개발 환경(`.env.local`)에서는 이 환경변수를 사용하지 않습니다. 로컬에서는 `GOOGLE_APPLICATION_CREDENTIALS` 파일 경로를 사용합니다.

## 💻 코드 구현

### GoogleTtsProvider

**위치**: `src/tts/tts.provider.ts`

```typescript
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

@Injectable()
export class GoogleTtsProvider implements TtsProvider, OnModuleInit {
  private client!: TextToSpeechClient;

  async onModuleInit(): Promise<void> {
    // 1. 로컬: 파일 경로
    const keyFilename = this.configService.get('GOOGLE_APPLICATION_CREDENTIALS');
    if (keyFilename && fs.existsSync(keyFilename)) {
      this.client = new TextToSpeechClient({ keyFilename });
      this.logger.log(`Google TTS initialized with key file: ${keyFilename}`);
      return;
    }

    // 2. EC2: AWS Secrets Manager
    const secretName = this.configService.get('GOOGLE_CREDENTIALS_SECRET_NAME');
    if (secretName) {
      const credentialsJson = await this.getCredentialsFromSecretsManager(secretName);
      const tempKeyPath = this.writeTempKeyFile(credentialsJson);
      this.client = new TextToSpeechClient({ keyFilename: tempKeyPath });
      this.logger.log('Google TTS initialized with credentials from AWS Secrets Manager');
      return;
    }

    throw new Error('Google Cloud credentials not configured');
  }

  private async getCredentialsFromSecretsManager(secretName: string): Promise<string> {
    const region = this.configService.get<string>('AWS_REGION') || 'ap-northeast-2';
    const client = new SecretsManagerClient({ region });

    try {
      const command = new GetSecretValueCommand({ SecretId: secretName });
      const response = await client.send(command);

      const secretString = response.SecretString as string | undefined;
      if (!secretString) {
        throw new Error('Secret value is empty');
      }

      this.logger.log(`Retrieved secret from AWS Secrets Manager: ${secretName}`);
      return secretString;
    } catch (error) {
      this.logger.error(`Failed to retrieve secret ${secretName}: ${error.message}`);
      throw error;
    }
  }

  private writeTempKeyFile(credentialsJson: string): string {
    // JSON 유효성 검사
    JSON.parse(credentialsJson);

    const tempDir = os.tmpdir();
    const keyPath = path.join(tempDir, `google-credentials-${Date.now()}.json`);

    fs.writeFileSync(keyPath, credentialsJson, 'utf-8');
    this.logger.debug(`Wrote temporary credentials file to ${keyPath}`);

    return keyPath;
  }
}
```

## 🧪 테스트

### AWS CLI로 시크릿 조회

```bash
# 시크릿 목록 확인
aws secretsmanager list-secrets --region ap-northeast-2 --query 'SecretList[*].Name'

# 특정 시크릿 조회
aws secretsmanager get-secret-value \
  --secret-id ddareungimap/googleCloud \
  --region ap-northeast-2 \
  --query SecretString \
  --output text

# JSON 파싱하여 project_id 확인
aws secretsmanager get-secret-value \
  --secret-id ddareungimap/googleCloud \
  --region ap-northeast-2 \
  --query SecretString \
  --output text | jq '.project_id'
```

### EC2에서 테스트

```bash
# EC2에 SSH 접속
ssh -i ~/.ssh/your-key.pem ubuntu@your-ec2-ip

# IAM Role 확인
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/

# 시크릿 조회 테스트
aws secretsmanager get-secret-value \
  --secret-id ddareungimap/googleCloud \
  --region ap-northeast-2 \
  --query SecretString \
  --output text | jq '.project_id'

# 응답 예시
"ethereal-entity-478102-d0"
```

### 애플리케이션 테스트

```bash
# EC2에서 애플리케이션 재시작
cd /home/ubuntu/ddareungi-map-be
pm2 restart ddareungimap-api

# 로그 확인
pm2 logs ddareungimap-api | grep -i "tts\|google"

# 성공 로그 예시
[GoogleTtsProvider] Retrieved secret from AWS Secrets Manager: ddareungimap/googleCloud
[GoogleTtsProvider] Google TTS initialized with credentials from AWS Secrets Manager
[TtsService] AWS S3 initialized with IAM Role (EC2)
```

## ⚠️ 트러블슈팅

### 1. 시크릿을 찾을 수 없음 (ResourceNotFoundException)

**증상**:
```
ResourceNotFoundException: Secrets Manager can't find the specified secret
```

**해결**:
1. 시크릿 이름 확인:
```bash
aws secretsmanager list-secrets --region ap-northeast-2 --query 'SecretList[*].Name'
```

2. `.env.production`의 시크릿 이름 확인
3. 리전 확인 (ap-northeast-2)
4. 시크릿이 없으면 생성

### 2. 권한 거부 (AccessDeniedException)

**증상**:
```
AccessDeniedException: User: arn:aws:sts::123456789012:assumed-role/... is not authorized to perform: secretsmanager:GetSecretValue
```

**해결**:
1. EC2 IAM Role 권한 확인
2. IAM 정책에 `secretsmanager:GetSecretValue` 추가
3. Resource ARN 패턴 확인:
```json
"Resource": "arn:aws:secretsmanager:ap-northeast-2:*:secret:ddareungimap/googleCloud-*"
```

4. EC2 인스턴스에 IAM Role 연결 확인:
```bash
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/
```

### 3. 시크릿 값이 비어있음

**증상**:
```
Error: Secret value is empty
```

**해결**:
1. 시크릿 내용 확인:
```bash
aws secretsmanager get-secret-value \
  --secret-id ddareungimap/googleCloud \
  --region ap-northeast-2
```

2. SecretString이 null이면 재생성
3. JSON 유효성 확인: `jq . file.json`

### 4. 임시 파일 쓰기 실패

**증상**:
```
Error: EACCES: permission denied, open '/tmp/google-credentials-*.json'
```

**해결**:
1. `/tmp` 디렉토리 권한 확인:
```bash
ls -ld /tmp
# drwxrwxrwt 10 root root ...
```

2. 디스크 공간 확인:
```bash
df -h /tmp
```

3. 다른 경로 사용 (환경변수로 설정 가능)

### 5. JSON 파싱 에러

**증상**:
```
SyntaxError: Unexpected token ... in JSON at position ...
```

**해결**:
1. 시크릿 내용 확인:
```bash
aws secretsmanager get-secret-value \
  --secret-id ddareungimap/googleCloud \
  --region ap-northeast-2 \
  --query SecretString \
  --output text | jq .
```

2. 유효하지 않은 JSON이면 재생성
3. 이스케이프 문자 확인

## 🔐 보안 권장사항

### 1. 최소 권한 원칙

```json
{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:GetSecretValue"
    // "secretsmanager:PutSecretValue" 불필요 (읽기만)
    // "secretsmanager:DeleteSecret" 불필요
  ],
  "Resource": "arn:aws:secretsmanager:ap-northeast-2:*:secret:ddareungimap/googleCloud-*"
}
```

### 2. 리소스 제한

```json
// ✅ 좋은 예: 특정 시크릿만
"Resource": "arn:aws:secretsmanager:ap-northeast-2:*:secret:ddareungimap/googleCloud-*"

// ❌ 나쁜 예: 모든 시크릿
"Resource": "*"
```

### 3. 조건부 접근 (선택 사항)

```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:GetSecretValue",
  "Resource": "arn:aws:secretsmanager:ap-northeast-2:*:secret:ddareungimap/*",
  "Condition": {
    "StringEquals": {
      "aws:RequestedRegion": "ap-northeast-2"
    }
  }
}
```

### 4. 암호화

- Secrets Manager는 기본적으로 AWS KMS로 암호화됨
- 추가 비용 없음 (AWS 관리형 키 사용 시)
- 고객 관리형 KMS 키 사용 가능 (선택 사항)

### 5. 감사 로깅

CloudTrail로 모든 시크릿 접근 기록:

```bash
# CloudTrail 이벤트 조회
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=ddareungimap/googleCloud \
  --max-results 10
```

## 📊 시크릿 관리

### 시크릿 업데이트

```bash
# 새 서비스 계정 키로 업데이트
aws secretsmanager update-secret \
  --secret-id ddareungimap/googleCloud \
  --secret-string file://new-service-account-key.json \
  --region ap-northeast-2

# 또는 put-secret-value 사용
aws secretsmanager put-secret-value \
  --secret-id ddareungimap/googleCloud \
  --secret-string file://new-service-account-key.json \
  --region ap-northeast-2
```

### 시크릿 로테이션 (수동)

1. Google Cloud에서 새 서비스 계정 키 생성
2. AWS Secrets Manager에 새 키 업데이트
3. 애플리케이션 재시작 (PM2 reload)
4. 이전 키 테스트
5. Google Cloud에서 이전 키 삭제

### 시크릿 버전 관리

```bash
# 시크릿 버전 목록
aws secretsmanager list-secret-version-ids \
  --secret-id ddareungimap/googleCloud \
  --region ap-northeast-2

# 특정 버전 조회
aws secretsmanager get-secret-value \
  --secret-id ddareungimap/googleCloud \
  --version-id <version-id> \
  --region ap-northeast-2
```

## 📈 비용

### Secrets Manager 요금

- **시크릿 저장**: $0.40 per secret per month
- **API 호출**: $0.05 per 10,000 API calls

**월간 예상 비용**:
- 1개 시크릿: $0.40/월
- PM2 reload 10회/월: $0.00 (무료 티어 10,000 호출)
- **총 비용**: $0.40/월

### 비용 절감 팁

1. 불필요한 시크릿 삭제
2. 시크릿 로테이션 빈도 최소화
3. API 호출 캐싱 (애플리케이션 시작 시 1회만 로드)

## 🔍 모니터링

### CloudWatch 메트릭

1. AWS Console > CloudWatch > 메트릭 > Secrets Manager
2. 주요 메트릭:
   - `GetSecretValue`: API 호출 수
   - `GetSecretValueErrors`: 에러 수

### CloudTrail 로그

```bash
# 최근 시크릿 접근 기록
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=GetSecretValue \
  --max-results 10 \
  --query 'Events[?Resources[?ResourceName==`ddareungimap/googleCloud`]]'
```

### 알림 설정

1. CloudWatch > 경보 > 경보 생성
2. 메트릭: `GetSecretValueErrors`
3. 조건: > 5 (5분 동안)
4. 작업: SNS 토픽으로 이메일 알림

## 📚 참고 자료

- [AWS Secrets Manager 공식 문서](https://docs.aws.amazon.com/secretsmanager/)
- [Secrets Manager 요금](https://aws.amazon.com/secrets-manager/pricing/)
- [AWS SDK for JavaScript v3 - Secrets Manager](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-secrets-manager/)
- [IAM 정책 예제](https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_examples.html)

## 🆚 대안 비교

| 방법 | 장점 | 단점 | 비용 |
|------|------|------|------|
| **Secrets Manager** | 자동 로테이션, 감사 로깅, 버전 관리 | 추가 비용 | $0.40/월 |
| **환경변수** | 무료, 간단 | 보안 취약, Git 노출 위험 | 무료 |
| **파일 업로드** | 간단 | 수동 관리, 보안 위험 | 무료 |
| **SSM Parameter Store** | 저렴 | 기능 제한적 | $0.05/월 |

**권장**: 프로덕션 환경에서는 **Secrets Manager** 사용
