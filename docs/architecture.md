# 아키텍처

## 컨테이너 구성

EC2 단일 인스턴스에서 Docker Compose로 3개 컨테이너를 운영. 호스트 Nginx가 TLS 종단 + 리버스 프록시.

```
                          Internet
                              │
                       (443 HTTPS / 80 HTTP)
                              │
                  ┌───────────▼───────────┐
                  │   Host Nginx (systemd)│  /etc/letsencrypt
                  │   ddareungimap.com    │  ssumpick.com
                  │   → 127.0.0.1:3000    │
                  └───────────┬───────────┘
                              │
   ┌──────────────────── docker network: ddareungimap_default ────────────────────┐
   │                          │                                                   │
   │   ┌──────────────────────▼─────────┐                                         │
   │   │ ddareungimap-api               │ ─── http://graphhopper:8989 ──┐         │
   │   │ NestJS (Node.js 24, dist/main) │                               │         │
   │   │ tini PID 1, non-root nodeapp   │                               │         │
   │   └──────────┬─────────────────────┘                               │         │
   │              │                                                     │         │
   │     ┌────────▼──────────┐                       ┌──────────────────▼────┐    │
   │     │ ddareungimap-redis│                       │ ddareungimap-gh       │    │
   │     │ redis:7-alpine    │                       │ GraphHopper (JVM)     │    │
   │     │ AOF + named volume│                       │ /home/ubuntu/         │    │
   │     │                   │                       │ graph-cache 바인드     │    │
   │     └───────────────────┘                       └───────────────────────┘    │
   └──────────────────────────────────────────────────────────────────────────────┘
```

## 외부 의존성

| 종류 | 서비스 | 용도 |
|------|--------|------|
| DB | Supabase Postgres (pooler) | TypeORM, autoLoadEntities |
| Object Storage | Supabase Storage (`tts` 버킷) | TTS 음성 파일 |
| Routing | GraphHopper (자체 호스팅, 동일 EC2 컨테이너) | 자전거·도보 경로 |
| 외부 API | 서울 열린데이터광장 | 따릉이 대여소 정보 |
| TTS | Google Cloud Text-to-Speech | 안내 음성 합성 |
| 분석 | GA4 Measurement Protocol | 사용자 이벤트 |
| OAuth | Google · Kakao · Naver | 소셜 로그인 |
| 메일 | Gmail SMTP (nodemailer) | 이메일 인증 코드 |
| 에러 추적 | Sentry (`@sentry/nestjs`, production만) | 예외 모니터링 |

자세한 계약·엔드포인트는 [external-services.md](external-services.md) 참조.

## NestJS 모듈 트리

`src/app.module.ts`에서 imports되는 도메인 모듈:

```
AppModule
├─ AuthModule         /auth/*  - JWT + 소셜 로그인 + 이메일 인증
├─ UserModule         /user/*  - 회원 가입·정보·탈퇴, /user/stats
├─ StationsModule     /stations/* - 대여소 조회·동기화
├─ RoutesModule       /routes/*   - 경로 계산
├─ NavigationModule   /navigation/* - 네비게이션 세션
├─ MapModule          /map, /auth_result.* - 정적 페이지
├─ LocationModule     /locations/* - 키워드/주소 검색 (Kakao Map API 래퍼)
├─ TtsModule          /tts/*       - 음성 합성 + 캐시 조회
├─ MailModule                      - 이메일 발송 (다른 모듈에서 호출)
├─ AnalyticsModule                 - GA4 이벤트 송신 (다른 모듈에서 호출)
└─ Common
   ├─ SupabaseModule, BenchmarkModule
   ├─ HttpLoggingModule (axios outgoing 로그)
   ├─ ClsModule (Trace ID)
   └─ ThrottlerModule (Rate limit)
```

전역으로 적용되는 것:
- `ValidationPipe`(whitelist + transform)
- `LoggingInterceptor` / `SentryInterceptor`
- `ApiExceptionFilter`
- `ThrottlerGuard` (APP_GUARD)
- DB 세션 타임존 `Asia/Seoul` 강제

## 컨테이너 통신 규칙

같은 docker network 내에서는 서비스명을 호스트로 사용 (DNS 자동 해결).

| 호출 | 주소 |
|------|------|
| NestJS → Redis | `redis:6379` |
| NestJS → GraphHopper | `http://graphhopper:8989` |
| Host Nginx → NestJS | `127.0.0.1:3000` (compose가 호스트 루프백에만 바인딩) |

## 호스트 시크릿 / 데이터 경로

| 호스트 경로 | 컨테이너 경로 | 비고 |
|-------------|--------------|------|
| `/home/ubuntu/ddareungi-map-be/.env.production` | `env_file` 자동 주입 | 환경변수 |
| `/home/ubuntu/ddareungi-map-be/ddareungimap-b829ea269d30.json` | `/app/...:ro` 바인드 | GCP TTS 서비스 계정 키 |
| `/home/ubuntu/graph-cache/` | `/app/graph-cache` (graphhopper 컨테이너) | CH 사전계산 그래프 |
| Docker named volume `ddareungimap_redis-data` | `/data` (redis 컨테이너) | AOF/RDB |
