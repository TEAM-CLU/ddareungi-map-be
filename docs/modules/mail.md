# 메일 (이메일 인증)

`src/mail/mail.service.ts`. nodemailer + Gmail SMTP.

## 발송자

`createTransport({ service: 'gmail', auth: { user: MAIL_USER, pass: MAIL_PASS } })`

- `MAIL_USER`: Gmail 주소 (발신자)
- `MAIL_PASS`: **Google 계정 앱 비밀번호** (일반 비밀번호로는 SMTP 인증 불가)

## 메서드

| 메서드 | 용도 |
|--------|------|
| `sendVerificationEmail(to, code)` | 이메일 인증 코드 (HTML 템플릿 + 10분 안내) |
| `sendNotificationEmail(to, subject, content)` | 일반 알림 |

## 이메일 인증 흐름

```
클라이언트 → POST /auth/send-verification-email { email }
   AuthService:
      - 6자리 코드 생성
      - Redis 에 { email → code } 저장 (TTL 10분)
      - MailService.sendVerificationEmail(email, code)

클라이언트 → POST /auth/verify-email { email, code }
   AuthService:
      - Redis 에서 email 조회 → 입력 code 일치 확인
      - 일치 시 Redis 에 verified flag 세팅 (TTL 짧게)
      - 응답 OK

클라이언트 → POST /user/create-user { email, password, ... }
   UserService:
      - Redis verified flag 확인
      - 통과 시 회원 생성 + JWT 발급
```

비밀번호 재설정도 동일한 코드 검증 패턴 (`POST /auth/reset-password`).

## 운영 주의

- Gmail SMTP 일일 발송 한도(약 500건/일/계정). 트래픽이 늘면 SES / Postmark 등으로 교체 검토.
- `console.log` 로 성공 로그가 찍힘 — winston 통합은 안 됨 (현재 코드 기준).
- HTML 템플릿이 서비스 코드 안에 인라인. 유지보수 시 별도 파일/템플릿 엔진 분리 후보.
