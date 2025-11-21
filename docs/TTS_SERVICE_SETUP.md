# TTS (Text-to-Speech) 서비스 설정 가이드

Google Cloud Text-to-Speech API를 사용하여 네비게이션 인스트럭션을 음성으로 변환하는 서비스 설정 가이드입니다.

## 📋 개요

- **제공**: Google Cloud Text-to-Speech API
- **용도**: 네비게이션 인스트럭션 음성 합성
- **음성**: ko-KR-Wavenet-A (한국어 여성 음성)
- **형식**: MP3 (S3에 저장)
- **사용 모듈**: `src/tts/` 모듈

## 🏗️ 아키텍처

```
Navigation Instruction (영어)
      │
      ▼
TranslationService (번역)
      │
      ▼
Korean Text
      │
      ▼
Redis Cache 확인
      │
      ├─ Hit → S3 URL 반환
      │
      └─ Miss ▼
      │
Google Cloud TTS (음성 합성)
      │
      ▼
MP3 Buffer
      │
      ▼
AWS S3 Upload
      │
      ▼
Redis Cache 저장 (30일 TTL)
      │
      ▼
S3 Public URL 반환
```

## 🔑 Google Cloud 설정

### 1. Google Cloud 프로젝트 생성

1. [Google Cloud Console](https://console.cloud.google.com) 접속
2. **새 프로젝트 만들기** 클릭
3. 프로젝트 이름 입력 (예: `ddareungi-map`)
4. **만들기** 클릭

### 2. Text-to-Speech API 활성화

1. 프로젝트 선택
2. 좌측 메뉴 > **API 및 서비스** > **라이브러리**
3. "Cloud Text-to-Speech API" 검색
4. **사용** 버튼 클릭
5. API가 활성화될 때까지 대기 (1-2분)

### 3. 서비스 계정 생성

1. 좌측 메뉴 > **IAM 및 관리자** > **서비스 계정**
2. **서비스 계정 만들기** 클릭
3. **서비스 계정 세부정보**:
   - 이름: `ddareungi-tts`
   - 설명: `Text-to-Speech API access for DDareungi Map`
4. **만들고 계속하기** 클릭
5. **역할 선택**:
   - `Cloud Text-to-Speech 사용자` 역할 추가
6. **완료** 클릭

### 4. 서비스 계정 키 다운로드

1. 생성한 서비스 계정 클릭
2. **키** 탭 선택
3. **키 추가** > **새 키 만들기**
4. 키 유형: **JSON** 선택
5. **만들기** 클릭
6. JSON 키 파일 자동 다운로드 (예: `ethereal-entity-478102-d0-d2603a45e6e9.json`)
7. **프로젝트 루트에 저장** (`.gitignore`에 이미 포함됨)

### 5. 비용 확인

- **무료 할당량**: 월 100만 문자 (Standard 음성)
- **유료 요금**: 
  - Standard 음성: $4 per 1 million characters
  - WaveNet 음성: $16 per 1 million characters
  - Neural2 음성: $16 per 1 million characters

**예상 사용량**:
- 평균 인스트럭션: 20자
- 월 10만 경로 * 10개 인스트럭션 = 200만 문자
- 예상 비용: $8/월 (Standard), $32/월 (WaveNet)

## ⚙️ 환경 설정

### 로컬 개발 환경 (`.env.local`)

```env
# Google Cloud TTS (로컬: 파일 경로)
GOOGLE_APPLICATION_CREDENTIALS=./your-service-account-key.json

# AWS S3 (로컬: IAM User Access Key)
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=AKIA******************
AWS_SECRET_ACCESS_KEY=********************************
TTS_S3_BUCKET=ddareungimap-tts-cache
```

### EC2 프로덕션 환경 (`.env.production`)

```env
# Google Cloud TTS (EC2: AWS Secrets Manager에서 자동 로드)
GOOGLE_CREDENTIALS_SECRET_NAME=your-project/googleCloud
AWS_REGION=ap-northeast-2

# AWS S3 (EC2: IAM Role로 자동 인증)
TTS_S3_BUCKET=ddareungimap-tts-cache
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY 불필요 (IAM Role 사용)
```

> 📝 **구성**:
> - Google Cloud에서 서비스 계정 키 생성
> - AWS Secrets Manager에 JSON 키 저장
> - AWS S3 버킷 생성 및 공개 읽기 정책 설정
> - 음성: ko-KR-Wavenet-A (한국어 여성) 권장

## 💻 코드 구현

### GoogleTtsProvider

**위치**: `src/tts/tts.provider.ts`

**주요 기능**:
- 로컬: 서비스 계정 키 파일 사용
- EC2: AWS Secrets Manager에서 자격 증명 로드
- 음성 합성 (텍스트 → MP3 Buffer)

```typescript
@Injectable()
export class GoogleTtsProvider implements TtsProvider, OnModuleInit {
  private client!: TextToSpeechClient;

  async onModuleInit(): Promise<void> {
    // 1. 로컬: 파일 경로
    const keyFilename = this.configService.get('GOOGLE_APPLICATION_CREDENTIALS');
    if (keyFilename && fs.existsSync(keyFilename)) {
      this.client = new TextToSpeechClient({ keyFilename });
      return;
    }

    // 2. EC2: AWS Secrets Manager
    const secretName = this.configService.get('GOOGLE_CREDENTIALS_SECRET_NAME');
    if (secretName) {
      const credentialsJson = await this.getFromSecretsManager(secretName);
      const tempKeyPath = this.writeTempKeyFile(credentialsJson);
      this.client = new TextToSpeechClient({ keyFilename: tempKeyPath });
      return;
    }

    throw new Error('Google Cloud credentials not configured');
  }

  async synthesize(text: string, lang = 'ko-KR'): Promise<Buffer> {
    const [response] = await this.client.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: lang,
        name: 'ko-KR-Wavenet-A', // 여성 음성
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.0, // 정상 속도
        pitch: 0, // 정상 음높이
      },
    });

    return Buffer.from(response.audioContent as Uint8Array);
  }
}
```

### TtsService

**위치**: `src/tts/tts.service.ts`

**주요 기능**:
- 번역 (영어 → 한국어)
- Redis 캐시 확인
- TTS 합성
- S3 업로드
- Redis 캐시 저장

```typescript
@Injectable()
export class TtsService {
  async synthesizeAndCache(text: string): Promise<TtsResponseDto> {
    // 1. 번역
    const textKo = this.translationService.translateToKorean(text);

    // 2. 해시 생성
    const hash = this.hashText(`ko-KR:${textKo}`);

    // 3. Redis 캐시 확인
    const cached = await this.redis.get(`tts:phrase:${hash}`);
    if (cached) {
      const record = JSON.parse(cached);
      return { status: 'ready', url: record.s3Url };
    }

    // 4. TTS 합성
    const audioBuffer = await this.ttsProvider.synthesize(textKo, 'ko-KR');

    // 5. S3 업로드
    const s3Key = `tts/ko-KR/${hash}.mp3`;
    await this.s3.putObject({
      Bucket: this.bucket,
      Key: s3Key,
      Body: audioBuffer,
      ContentType: 'audio/mpeg',
    }).promise();

    const s3Url = `https://${this.bucket}.s3.amazonaws.com/${s3Key}`;

    // 6. Redis 캐시 저장 (30일)
    const record = { text, textKo, s3Url, hash, createdAt: Date.now() };
    await this.redis.setex(`tts:phrase:${hash}`, 86400 * 30, JSON.stringify(record));

    return { status: 'ready', url: s3Url };
  }

  // 배치 처리 (중복 제거 + 병렬 처리)
  async batchSynthesize(instructions: Array<{text: string}>): Promise<Map<string, TtsResponseDto>> {
    const uniqueTexts = Array.from(new Set(instructions.map(i => i.text)));
    
    const promises = uniqueTexts.map(text => 
      this.synthesizeAndCache(text).then(result => ({ text, result }))
    );

    const results = await Promise.all(promises);
    
    return new Map(results.map(({ text, result }) => [text, result]));
  }
}
```

### TranslationService

**위치**: `src/tts/translation.service.ts`

**주요 기능**:
- 패턴 매칭 기반 영어 → 한국어 번역
- GraphHopper 인스트럭션 용어 변환

```typescript
@Injectable()
export class TranslationService {
  private readonly PATTERNS: Array<[RegExp, string]> = [
    [/Turn left/i, '좌회전하세요'],
    [/Turn right/i, '우회전하세요'],
    [/Continue straight/i, '직진하세요'],
    [/Arrive at/i, '목적지에 도착했습니다'],
    // ... 더 많은 패턴
  ];

  translateToKorean(text: string): string {
    for (const [pattern, replacement] of this.PATTERNS) {
      if (pattern.test(text)) {
        return text.replace(pattern, replacement);
      }
    }
    return text; // 매칭 실패 시 원본 반환
  }
}
```

## 🧪 테스트

### 로컬 테스트

```bash
# 로컬 서버 실행
pnpm run start:local

# TTS 테스트 엔드포인트
curl -X POST "http://localhost:3000/tts/test" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "100미터 직진 후 좌회전하세요",
    "lang": "ko-KR"
  }'

# 응답
{
  "status": "ready",
  "url": "https://ddareungimap-tts-cache.s3.amazonaws.com/tts/ko-KR/abc123.mp3",
  "hash": "abc123...",
  "textKo": "100미터 직진 후 좌회전하세요"
}
```

### 네비게이션 통합 테스트

```bash
# 네비게이션 시작 (자동으로 TTS 생성)
curl -X POST "http://localhost:3000/navigation/start" \
  -H "Content-Type: application/json" \
  -d '{
    "routeId": "test-route-123",
    "currentLocation": {"lat": 37.5665, "lng": 126.9780}
  }'

# 응답에서 instructions[].ttsUrl 확인
{
  "sessionId": "abc-123",
  "instructions": [
    {
      "text": "Continue for 150 meters",
      "ttsUrl": "https://...s3.amazonaws.com/.../hash1.mp3",
      "nextTurnCoordinate": {"lat": 37.5666, "lng": 126.9781}
    }
  ]
}
```

### Redis 캐시 확인

```bash
# Redis CLI 접속
redis-cli

# TTS 캐시 키 조회
KEYS tts:phrase:*

# 특정 캐시 내용 확인
GET tts:phrase:abc123...

# 응답 (JSON)
{
  "text": "Continue for 150 meters",
  "textKo": "150미터 직진하세요",
  "s3Url": "https://...",
  "hash": "abc123...",
  "createdAt": 1700000000000
}
```

## 📊 데이터 흐름

### 네비게이션 시작 시

```
1. POST /navigation/start
      │
2. RouteService.getRoute(routeId)
      │
3. NavigationHelperService.addTtsToInstructions()
      │
4. TtsService.batchSynthesize(instructions)
      │
5. ┌─ 고유 텍스트 추출 (중복 제거)
   ├─ 병렬 처리 (Promise.all)
   │   ├─ Redis 캐시 확인
   │   ├─ 캐시 미스 → TTS 합성
   │   ├─ S3 업로드
   │   └─ Redis 캐시 저장
   └─ Map<text, TtsResponseDto> 반환
      │
6. instructions[].ttsUrl 설정
      │
7. Response 반환
```

## ⚠️ 트러블슈팅

### 1. 인증 실패 (Could not load credentials)

**증상**:
```
Error: Could not load the default credentials
```

**로컬 해결**:
1. `GOOGLE_APPLICATION_CREDENTIALS` 경로 확인
2. JSON 파일 존재 여부 확인
3. JSON 파일 유효성 확인 (`jq . file.json`)

**EC2 해결**:
1. AWS Secrets Manager에 시크릿 존재 확인:
```bash
aws secretsmanager list-secrets --region ap-northeast-2
```

2. IAM Role 권한 확인 (secretsmanager:GetSecretValue)
3. `.env.production`에 `GOOGLE_CREDENTIALS_SECRET_NAME` 설정 확인

### 2. TTS API 할당량 초과

**증상**:
```
Error: 429 Resource has been exhausted (e.g. check quota)
```

**해결**:
1. [Google Cloud Console > 할당량](https://console.cloud.google.com/iam-admin/quotas) 확인
2. 할당량 증가 요청 (무료 → 유료 전환)
3. Redis 캐시 TTL 증가 (30일 → 60일)
4. 요청 빈도 제한 구현

### 3. S3 업로드 실패 (Access Denied)

**증상**:
```
AccessDenied: Access Denied
```

**로컬 해결**:
1. AWS Access Key 확인
2. IAM 사용자에 S3 PutObject 권한 추가
3. `.env.local`에 `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` 확인

**EC2 해결**:
1. EC2 IAM Role에 S3 PutObject 권한 추가
2. 버킷 정책 확인
3. 버킷 이름 확인 (`TTS_S3_BUCKET`)

### 4. TTS URL이 instructions에 포함되지 않음

**증상**:
- `instructions[].ttsUrl`이 `undefined`

**해결**:
1. PM2 로그 확인:
```bash
pm2 logs ddareungimap-api | grep -i "tts"
```

2. TTS 합성 에러 확인:
```
[TtsService] TTS synthesis failed: ...
```

3. Redis 연결 확인
4. S3 버킷 존재 확인

### 5. 음성 재생 안 됨

**증상**:
- S3 URL은 반환되지만 재생 불가

**해결**:
1. S3 URL 브라우저에서 직접 접속 테스트
2. S3 버킷 공개 읽기 권한 확인 (버킷 정책)
3. CORS 설정 확인
4. ContentType이 `audio/mpeg`인지 확인

## 📈 성능 최적화

### 1. 배치 처리 최적화

```typescript
// ✅ 좋은 예: 중복 제거 + 병렬 처리
async batchSynthesize(instructions: Instruction[]) {
  const uniqueTexts = [...new Set(instructions.map(i => i.text))];
  return await Promise.all(uniqueTexts.map(text => this.synthesize(text)));
}

// ❌ 나쁜 예: 순차 처리 + 중복
async batchSynthesize(instructions: Instruction[]) {
  for (const instruction of instructions) {
    await this.synthesize(instruction.text); // 느림!
  }
}
```

### 2. Redis 캐시 전략

```typescript
// 일반 TTS: 30일 TTL
await redis.setex(key, 86400 * 30, data);

// 고정 메시지 (환영, 종료): 10년 TTL (사실상 영구)
await redis.setex(key, 86400 * 365 * 10, data);
```

### 3. S3 URL 최적화

```typescript
// ✅ 직접 S3 URL (빠름)
const url = `https://${bucket}.s3.amazonaws.com/${key}`;

// ❌ Signed URL (느림, 불필요)
const url = await s3.getSignedUrlPromise('getObject', {Bucket, Key});
```

## 🔐 보안 권장사항

### 1. 서비스 계정 키 보호

- ✅ `.gitignore`에 JSON 파일 포함
- ✅ EC2에서는 AWS Secrets Manager 사용
- ❌ 환경변수에 JSON 문자열 직접 입력 금지

### 2. S3 버킷 보안

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::ddareungimap-tts-cache/tts/*"
    }
  ]
}
```

- ✅ 공개 읽기만 허용 (`s3:GetObject`)
- ✅ 특정 경로만 공개 (`/tts/*`)
- ❌ 쓰기 권한 공개 금지

### 3. API 키 로테이션

- 6개월마다 서비스 계정 키 재생성
- 이전 키 비활성화 전 테스트
- AWS Secrets Manager에 새 키 업데이트

## 📚 참고 자료

- [Google Cloud TTS 문서](https://cloud.google.com/text-to-speech/docs)
- [Google Cloud TTS 가격](https://cloud.google.com/text-to-speech/pricing)
- [Google Cloud TTS Node.js Client](https://github.com/googleapis/nodejs-text-to-speech)
- [음성 및 언어 목록](https://cloud.google.com/text-to-speech/docs/voices)

## 🎵 음성 커스터마이징

### 음성 선택

```typescript
// 여성 음성 (기본)
name: 'ko-KR-Wavenet-A'

// 남성 음성
name: 'ko-KR-Wavenet-C'

// Standard 음성 (저렴)
name: 'ko-KR-Standard-A'
```

### 속도 및 음높이 조정

```typescript
audioConfig: {
  speakingRate: 1.2, // 1.2배속 (0.25 ~ 4.0)
  pitch: 2.0,        // 높은 음높이 (-20.0 ~ 20.0)
}
```

### SSML 사용 (고급)

```typescript
input: {
  ssml: '<speak>100미터 <break time="500ms"/> 직진하세요</speak>'
}
```
