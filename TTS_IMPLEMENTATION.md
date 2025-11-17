# TTS (Text-to-Speech) 통합 완료

## 🎯 구현 내용

네비게이션 인스트럭션을 한글로 번역하고 Google Cloud TTS를 사용하여 음성 합성한 뒤, S3에 캐싱하여 클라이언트에 URL을 제공하는 기능을 구현했습니다.

## 📦 추가된 모듈

### 1. TTS Module (`src/tts/`)

- **TtsService**: 메인 서비스, 번역 → 합성 → S3 업로드 → Redis 캐싱
- **GoogleTtsProvider**: Google Cloud TTS API 연동
- **TranslationService**: 영어 → 한글 번역 (패턴 매칭 또는 Google Translate API)
- **DTO**: TtsRequestDto, TtsResponseDto, TtsRecord

### 2. 주요 기능

#### 자동 번역 및 TTS 생성

```typescript
// NavigationService.startNavigationSession() 내부에서 자동 처리
const ttsResults = await this.ttsService.batchSynthesize(
  allInstructions,
  'ko-KR',
);
```

#### 캐싱 메커니즘

- **Redis**: 텍스트 해시 → S3 URL 매핑 (TTL 30일)
- **S3**: 음성 파일 영구 저장 (MP3 형식)
- **중복 방지**: 동일 텍스트는 캐시에서 재사용

#### 응답 구조 변경

```json
{
  "sessionId": "uuid",
  "instructions": [
    {
      "text": "Continue for 150 meters",
      "textKo": "150미터 직진하세요",
      "ttsUrl": "https://bucket.s3.amazonaws.com/tts/ko-KR/hash.mp3",
      "distance": 150,
      "time": 30,
      "sign": 0,
      "interval": [0, 10]
    }
  ]
}
```

## 🔧 설정 방법

### 1. Google Cloud TTS 설정

```bash
# 1. Google Cloud Console에서 서비스 계정 생성
# 2. Cloud Text-to-Speech API 활성화
# 3. JSON 키 다운로드

# 환경변수 설정
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
```

### 2. AWS S3 설정

```bash
# .env 파일에 추가
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
TTS_S3_BUCKET=your-bucket-name
```

### 3. S3 버킷 정책 (공개 읽기)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::your-bucket/tts/*"
    }
  ]
}
```

## 📝 사용 예시

### 네비게이션 세션 시작

```bash
POST /navigation/start
{
  "routeId": "route-123"
}

# 응답에 ttsUrl 포함
{
  "sessionId": "session-456",
  "instructions": [
    {
      "text": "Turn left",
      "textKo": "좌회전하세요",
      "ttsUrl": "https://bucket.s3.amazonaws.com/tts/ko-KR/abc123.mp3"
    }
  ]
}
```

### 클라이언트에서 재생

```javascript
const audio = new Audio(instruction.ttsUrl);
audio.play();
```

## 🔄 처리 흐름

1. 사용자가 네비게이션 세션 시작
2. 서버가 모든 인스트럭션 추출
3. 각 인스트럭션에 대해:
   - 텍스트 정규화
   - 한글로 번역
   - Redis에서 캐시 확인
   - 캐시 미스 시:
     - Google Cloud TTS로 음성 합성
     - S3에 MP3 업로드
     - Redis에 캐시 저장
4. 모든 인스트럭션에 `ttsUrl` 추가하여 응답

## 📊 번역 패턴

TranslationService는 다음 패턴을 자동으로 한글로 변환합니다:

- `Continue` → `직진하세요`
- `Turn left` → `좌회전하세요`
- `Turn right` → `우회전하세요`
- `Turn sharp left` → `급좌회전하세요`
- `Turn sharp right` → `급우회전하세요`
- `Keep left` → `좌측으로 가세요`
- `Arrive at destination` → `목적지에 도착했습니다`
- 거리: `150m` → `150미터`

## 💰 비용 최적화

1. **Redis 캐싱**: 동일 텍스트 재사용 (30일 TTL)
2. **S3 수명 주기**: 90일 후 자동 삭제 권장
3. **배치 처리**: 세션 시작 시 일괄 처리

## 🚀 다음 단계 (선택사항)

- [ ] 단위 테스트 작성 (`tts.service.spec.ts`)
- [ ] Google Translate API 연동 (고급 번역)
- [ ] CloudFront CDN 추가 (더 빠른 전송)
- [ ] 음성 속도/톤 커스터마이징
- [ ] 다국어 지원 확장

## 📚 참고 문서

- [Google Cloud TTS 문서](https://cloud.google.com/text-to-speech/docs)
- [AWS S3 문서](https://docs.aws.amazon.com/s3/)
- [ENVIRONMENT_GUIDE.md](./ENVIRONMENT_GUIDE.md) - 상세 환경변수 설정
- [.env.tts.example](./.env.tts.example) - 환경변수 예제
