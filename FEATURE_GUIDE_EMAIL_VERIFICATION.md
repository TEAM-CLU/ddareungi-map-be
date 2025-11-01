# Email Verification & Account Lookup Flow - 구현 완료

## 📋 구현된 기능 개요

이메일 인증 후 계정 찾기 기능이 완성되었습니다. 암호화된 securityToken을 통해 안전한 계정 조회가 가능합니다.

---

## 🔄 전체 흐름

### 1단계: 이메일 인증 코드 발송
```
POST /auth/send-verification-email
Body: { email: "user@example.com" }
Response: { message: "인증코드 발송완료. 10분내 인증 필요" }
```

### 2단계: 인증 코드 검증 + securityToken 발급
```
POST /auth/verify-email
Body: { email: "user@example.com", verificationCode: "123456" }
Response: {
  message: "이메일 인증이 완료되었습니다.",
  isVerified: true,
  securityToken: "base64EncodedEncryptedEmail..."  ← 새로 추가됨!
}
```

### 3단계: 계정 찾기 (securityToken 사용)
```
POST /auth/find-account
Body: { securityToken: "base64EncodedEncryptedEmail..." }
Response: {
  isRegistered: boolean,
  accountType: "소셜" | "자체",
  message: "친화적인 메시지"
}
```

---

## 🛠️ 핵심 구현 사항

### 1. CryptoService (암호화/복호화)
**파일**: `src/common/crypto.service.ts`

- **알고리즘**: AES-256-GCM (NIST 권장, 가장 안전함)
- **키 길이**: 32바이트 (256비트)
- **IV**: 16바이트 (매 암호화마다 랜덤 생성)
- **인증 태그**: 16바이트 (데이터 무결성 보증)

```typescript
// 암호화
const securityToken = this.cryptoService.encrypt("user@example.com");
// 결과: "base64EncodedString"

// 복호화
const email = this.cryptoService.decrypt("base64EncodedString");
// 결과: "user@example.com"
```

**환경 변수 설정 필수**:
```bash
# .env 파일에 추가
ENCRYPTION_KEY=<32바이트 hex string (64자)>

# 생성 방법:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. DTO 수정 사항

#### VerifyEmailResponseDto (email-verification.dto.ts)
```typescript
export class VerifyEmailResponseDto {
  message: string;           // "이메일 인증이 완료되었습니다."
  isVerified: boolean;       // true
  securityToken: string;     // 암호화된 이메일 (새로 추가)
}
```

#### FindAccountResponseDto (find-account.dto.ts) - 새로 생성
```typescript
export class FindAccountResponseDto {
  isRegistered: boolean;     // 가입 여부
  accountType: "소셜" | "자체";  // 계정 유형
  message: string;           // 프론트에 표시할 메시지
}
```

### 3. 비즈니스 로직 (AuthService)

#### verifyEmail 메서드 수정
```typescript
async verifyEmail(verifyEmailDto: VerifyEmailDto): Promise<VerifyEmailResponseDto> {
  // ... 기존 인증 코드 검증 로직 ...
  
  // 이메일을 암호화하여 securityToken 생성 (새로 추가)
  const securityToken = this.cryptoService.encrypt(normalizedEmail);
  
  return {
    message: "이메일 인증이 완료되었습니다.",
    isVerified: true,
    securityToken: securityToken,
  };
}
```

#### findAccount 메서드 추가 (새로 생성)
```typescript
async findAccount(
  findAccountRequestDto: FindAccountRequestDto
): Promise<FindAccountResponseDto> {
  // 1. securityToken 복호화하여 이메일 추출
  const email = this.cryptoService.decrypt(findAccountRequestDto.securityToken);
  
  // 2. DB에서 이메일로 사용자 조회
  const user = await this.userRepository.findOne({ where: { email } });
  
  // 3. 결과에 따라 응답
  if (!user) {
    return {
      isRegistered: false,
      accountType: "자체",
      message: "가입되지 않은 이메일입니다. 새로 가입해주세요.",
    };
  }
  
  // 소셜 계정 여부 판별
  if (user.socialName && user.socialUid) {
    return {
      isRegistered: true,
      accountType: "소셜",
      message: `이미 ${user.socialName} 계정으로 가입된 이메일입니다. ${user.socialName} 로그인을 사용해주세요.`,
    };
  } else {
    return {
      isRegistered: true,
      accountType: "자체",
      message: "이미 가입된 이메일입니다. 로그인해주세요.",
    };
  }
}
```

### 4. API 엔드포인트 추가

#### POST /auth/find-account
```
요청:
{
  "securityToken": "base64EncodedEncryptedEmail..."
}

응답 예시 1) 가입되지 않은 이메일:
{
  "isRegistered": false,
  "accountType": "자체",
  "message": "가입되지 않은 이메일입니다. 새로 가입해주세요."
}

응답 예시 2) 소셜 계정으로 가입:
{
  "isRegistered": true,
  "accountType": "소셜",
  "message": "이미 구글 계정으로 가입된 이메일입니다. 구글 로그인을 사용해주세요."
}

응답 예시 3) 자체 회원가입:
{
  "isRegistered": true,
  "accountType": "자체",
  "message": "이미 가입된 이메일입니다. 로그인해주세요."
}
```

---

## 📝 프론트엔드 통합 가이드

### 시나리오 1: 계정 찾기 플로우
```javascript
// 1단계: 이메일 입력 후 인증 코드 발송
const sendCode = async (email) => {
  const res = await fetch('/auth/send-verification-email', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
};

// 2단계: 인증 코드 입력 후 검증
const verifyCode = async (email, code) => {
  const res = await fetch('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ email, verificationCode: code }),
  });
  const data = await res.json();
  localStorage.setItem('securityToken', data.securityToken); // 저장!
  return data;
};

// 3단계: 계정 찾기
const findAccount = async () => {
  const securityToken = localStorage.getItem('securityToken');
  const res = await fetch('/auth/find-account', {
    method: 'POST',
    body: JSON.stringify({ securityToken }),
  });
  const data = await res.json();
  
  // data.isRegistered와 data.accountType에 따라 분기 처리
  if (data.isRegistered) {
    if (data.accountType === '소셜') {
      // 소셜 로그인으로 유도
      showSocialLoginButton(data.message);
    } else {
      // 자체 로그인으로 유도
      showLoginForm(data.message);
    }
  } else {
    // 회원가입으로 유도
    showSignupForm(data.message);
  }
};
```

---

## 🔒 보안 특징

1. **암호화 통신**: 이메일을 평문으로 전송하지 않음
2. **무결성 검증**: AES-GCM의 authTag로 데이터 위변조 감지
3. **타임리미트**: 인증 코드 10분 유효 (기존 기능)
4. **환경 변수 관리**: 암호화 키를 코드에 하드코딩하지 않음
5. **비파괴적 복호화**: 복호화 실패 시 명확한 에러 메시지

---

## 📦 수정된 파일 목록

| 파일 | 변경 사항 |
|------|---------|
| `src/common/crypto.service.ts` | 🆕 새로 생성 - AES-256-GCM 암호화 |
| `src/auth/dto/email-verification.dto.ts` | ✏️ VerifyEmailResponseDto 추가 |
| `src/auth/dto/find-account.dto.ts` | 🆕 새로 생성 - FindAccountRequestDto, FindAccountResponseDto |
| `src/auth/auth.service.ts` | ✏️ verifyEmail 수정, findAccount 메서드 추가 |
| `src/auth/auth.controller.ts` | ✏️ verifyEmail 응답 타입 수정, find-account 엔드포인트 추가 |
| `src/auth/auth.module.ts` | ✏️ CryptoService 주입 |

---

## 🚀 배포 전 필수 사항

```bash
# 1. 암호화 키 생성
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. 환경 변수 설정 (.env, .env.production)
ENCRYPTION_KEY=<생성된 키>

# 3. 타입 체크
pnpm run build

# 4. 테스트 실행
pnpm run test

# 5. 로컬 개발 환경 테스트
pnpm run start:local
```

---

## 💡 주요 설계 결정

| 항목 | 선택 | 이유 |
|------|------|------|
| 암호화 알고리즘 | AES-256-GCM | NIST 승인, 가장 안전, 무결성 검증 포함 |
| 토큰 형식 | Base64 | URL 안전, 대부분의 시스템 호환성 |
| 의사결정 필드 | socialName, socialUid | DB 스키마와 일치 |
| 메시지 포맷 | 사용자 친화적 | 프론트에서 그대로 표시 가능 |

---

## ❓ FAQ

### Q: securityToken의 유효 시간은?
**A**: 현재 설정 없음. 프론트에서 verify-email 직후 즉시 find-account를 호출하는 것으로 가정합니다. 필요 시 timestamp 검증 추가 가능.

### Q: 암호화 키 로테이션은?
**A**: 현재 미구현. 프로덕션 환경에서는 주기적 로테이션 정책 수립 권장.

### Q: 대량 계정 찾기 공격 방어는?
**A**: 레이트 리미팅 미포함. API Gateway 레벨에서 추가 권장.

---

## 📞 문의
구현 과정에서 문제가 발생하면 `securityToken` 관련 로직, 암호화 키 설정, 또는 DTO 검증을 우선 확인하세요.
