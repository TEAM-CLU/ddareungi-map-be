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

| 설정 | 로컬 | 프로덕션 |
|------|------|----------|
| BASE_URL | http://localhost:3000 | https://production-domain.com |
| DB_HOST | localhost | 프로덕션 DB 호스트 |
| 소셜 로그인 콜백 | localhost:3000/auth/... | 프로덕션 도메인/auth/... |
| CORS_ORIGINS | localhost:3000,3001,8080 | 실제 프론트엔드 도메인들 |

## 🔧 로컬 개발 환경 설정

1. `.env.local` 파일 생성
2. 필요한 환경변수 설정:
   ```env
   NODE_ENV=local
   BASE_URL=http://localhost:3000
   
   # 데이터베이스
   DB_HOST=localhost
   DB_PORT=5432
   DB_USERNAME=your_username
   DB_PASSWORD=your_password
   DB_DATABASE=ddareungi_local
   
   # 소셜 로그인 (개발용)
   GOOGLE_CLIENT_ID=your_dev_google_client_id
   GOOGLE_CLIENT_SECRET=your_dev_google_client_secret
   GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
   GOOGLE_PKCE_CALLBACK_URL=http://localhost:3000/auth/google/pkce/callback
   
   # ... 기타 설정
   ```

3. 로컬 서버 실행:
   ```bash
   pnpm run start:local
   ```

## 🌐 PKCE 로그인 테스트

### 로컬에서 테스트:
```javascript
// 1. PKCE URL 받기
fetch('http://localhost:3000/auth/google/pkce')
  .then(res => res.json())
  .then(data => {
    sessionStorage.setItem('code_verifier', data.codeVerifier);
    sessionStorage.setItem('state', data.state);
    window.location.href = data.authUrl;
  });

// 2. 콜백 처리 (콜백 페이지에서)
const code = new URLSearchParams(window.location.search).get('code');
const state = new URLSearchParams(window.location.search).get('state');
const codeVerifier = sessionStorage.getItem('code_verifier');

fetch(`http://localhost:3000/auth/google/pkce/callback?code=${code}&code_verifier=${codeVerifier}&state=${state}`)
  .then(res => res.json())
  .then(result => console.log('로그인 결과:', result));
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