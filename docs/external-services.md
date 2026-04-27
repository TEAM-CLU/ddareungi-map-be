# 외부 서비스

각 서비스의 계약(엔드포인트·인증·코드 위치)과 운영 시 알아야 할 점.

---

## 1. Supabase Postgres

**용도**: 주 데이터베이스. TypeORM 으로 접근 (`autoLoadEntities: true`, `synchronize: true`).

**연결**:
- Host: `aws-1-ap-northeast-2.pooler.supabase.com`
- Port: `6543` (Transaction pooler — 단일 트랜잭션 단위로 커넥션 재사용)
- User: `postgres.<project-ref>`
- SSL 필수 (`rejectUnauthorized: false`)

**중요 설정** (`src/app.module.ts` TypeOrmModule):
- 모든 세션 timezone `Asia/Seoul` 강제 (`extra: { options: '-c timezone=Asia/Seoul' }`)
- `synchronize: true` — 엔티티 변경 시 자동 마이그레이션. **운영에선 신중히** (의도치 않은 컬럼 변경 위험)
- `maxQueryExecutionTime`: prod 1000ms / dev 300ms — 초과 시 winston warn

**Pooler 모드 주의**:
- Transaction pool 모드는 prepared statements 미지원. TypeORM 일부 기능에서 충돌 가능
- 5432 (Session pooler) / 6543 (Transaction) 차이 인지 필요

**자격증명 만료 시 증상**: NestJS 부팅에서 `tenant/user postgres.<ref> not found` → 컨테이너 crash loop. Supabase 콘솔에서 프로젝트 활성화 확인.

---

## 2. Supabase Storage (TTS 음성 파일)

**용도**: TTS 합성된 mp3 저장. **AWS S3 아님**.

**버킷**: `tts` (`src/tts/tts.constants.ts: STORAGE_BUCKET = 'tts'`)

**경로 규약** (`src/tts/services/tts-storage.service.ts`):
- `permanent/<hash>.mp3` — 영구 보관 (대여소 안내 등 자주 쓰는 문구)
- 임시 — TTL 만료 후 `tts-storage-cleanup.service.ts` 가 주기적 삭제

**접근**: `@supabase/supabase-js` 클라이언트가 `SUPABASE_URL` + `SUPABASE_SECRET_KEY` 로 인증.

**조회 엔드포인트**:
- `GET /tts/lookup` — 임시 파일 URL
- `GET /tts/lookup-permanent` — 영구 파일 URL
- `GET /tts/lookup-s3` / `lookup-s3-permanent` — (이름은 s3이지만 실제로는 Supabase Storage 시그니처 URL 반환)

---

## 3. GraphHopper (자체 호스팅)

**용도**: 자전거·도보 경로 계산. 동일 EC2 컨테이너로 운영.

**컨테이너**: `local/ddareungimap-gh:latest` (자체 빌드 이미지)
- 베이스: `openjdk:17-jdk-slim`
- 산출물: `graphhopper-web-8.0.jar`
- 빌드 컨텍스트: `/home/ubuntu/graphhopper-server/` (jar + OSM pbf + custom_models + srtm-cache)
- 명령: `java -Xmx2g -XX:-UseContainerSupport -jar graphhopper-web-8.0.jar server config.yml`
- 그래프 캐시: 호스트 `/home/ubuntu/graph-cache` 바인드 마운트 (CH 사전계산 완료, 약 600MB)

**프로파일** (`config.yml` + `src/routes/dto/route.dto.ts`):

| 프로파일 | 용도 | 가중치 모델 |
|---------|------|------------|
| `safe_bike` | 자전거 도로 우선 | `custom_models/safe_bike.json` |
| `fast_bike` | 빠른 경로 | `custom_models/fast_bike.json` |
| `foot` | 도보 (대여소까지 접근) | `custom_models/foot.json` |

**API 호출 위치**: `src/routes/services/graphhopper.service.ts`. RoutesModule 이 `start → 출발 대여소 (foot)`, `대여소 → 대여소 (safe/fast_bike)`, `도착 대여소 → end (foot)` 식으로 다단 조합.

**컨테이너 외부 노출 없음**: 보안그룹 8989 폐쇄. NestJS 컨테이너만 docker network로 접근.

**OSM 데이터**: `south-korea-latest.osm.pbf` (Geofabrik). 그래프 재빌드 시에만 필요. 평소엔 캐시로 동작 — 디스크 절약 위해 운영 EC2엔 pbf 파일을 두지 않음.

**헬스체크**: `GET /health` → `OK` (text)

---

## 4. Redis (자체 호스팅, 컨테이너)

**용도**: 분산 락, 세션 캐시.

**컨테이너**: `redis:7-alpine`
- 명령: `redis-server --appendonly yes --save 60 1` (AOF + 60초/1키 RDB)
- 영속: docker named volume `ddareungimap_redis-data`
- 외부 노출 없음. NestJS 컨테이너에서 `redis:6379` 호스트로만 접근

**클라이언트**: `@liaoliaots/nestjs-redis` (`ioredis` 기반). 글로벌 모듈, 어느 서비스에서도 `@InjectRedis()` 로 주입 가능.

**대표 사용처**: `src/stations/services/station-realtime-lock.service.ts` — 대여소 실시간 동기화 락.

---

## 5. 서울 열린데이터광장 (따릉이 대여소)

**용도**: 따릉이 대여소 마스터 + 실시간 대여 가능 수.

**Base URL**: `http://openapi.seoul.go.kr:8088` (HTTPS 미지원, HTTP only)

**API 키**: `SEOUL_OPEN_API_KEY` 환경변수. URL path 일부로 들어감.

**호출 위치**: `src/stations/services/seoul-api.service.ts`.

**동기화 흐름** (`StationSyncService` / `StationBatchRealtimeSyncService`):
- 부팅 시 1회 (`startup_check`) — 마지막 동기화 시점이 충분히 가까우면 스킵
- 스케줄러 주기 동기화 — 대여소 마스터 + 실시간 대여 가능 수
- 분산 락 (Redis) 으로 인스턴스 다중 시 중복 방지

**알려진 이슈**: 일부 대여소가 좌표 누락(location null) 으로 들어와 INSERT 실패. `StationSyncService`에서 try/catch + warn 후 다음 건 진행.

---

## 6. Google Cloud Text-to-Speech

**용도**: 네비게이션 안내 음성, 대여소 안내 멘트 합성.

**자격증명**: GCP 서비스 계정 키 JSON.
- 호스트 경로: `/home/ubuntu/ddareungi-map-be/ddareungimap-b829ea269d30.json`
- 컨테이너 마운트: `/app/...:ro` (read-only)
- 환경변수: `GOOGLE_APPLICATION_CREDENTIALS=./ddareungimap-b829ea269d30.json` (컨테이너 WORKDIR `/app` 기준 상대 경로)

**클라이언트**: `@google-cloud/text-to-speech` SDK.

**호출 위치**: `src/tts/services/tts-synthesis.service.ts`. 합성 결과를 `tts-storage.service.ts`가 Supabase Storage 에 업로드.

**텍스트 청크**: `tts-text-chunk.service.ts`가 긴 문장을 GCP TTS 한도 안에 들어가게 분할.

---

## 7. GA4 Measurement Protocol

**용도**: 사용자 이벤트(라우트 시작·완료, 네비 이벤트 등) GA4 전송.

**엔드포인트**: `https://www.google-analytics.com/mp/collect` (`Ga4MeasurementProtocolClient`)

**자격증명**: `GA4_MEASUREMENT_ID` + `GA4_API_SECRET`. 둘 다 없으면 송신 비활성 (no-op).

**식별자 해석**: `AnalyticsIdentityResolver` 가 JWT 사용자 ID + 익명 cookie ID 매핑.

**호출 위치**: `src/analytics/analytics.service.ts`. Stations / Navigation / Routes 등에서 이벤트 송신 시 `AnalyticsService` 의존성 주입.

---

## 8. OAuth — Google · Kakao · Naver

**전략**: passport.js (`src/auth/strategies/`).
- `google.strategy.ts` — `passport-google-oauth20`
- `kakao.strategy.ts` — `passport-kakao`
- `naver.strategy.ts` — `passport-naver-v2`

**플로우 종류**:
- 표준 Authorization Code Flow — `*_CALLBACK_URL`
- PKCE Flow (모바일/SPA) — `*_PKCE_CALLBACK_URL`

**엔드포인트** (`src/auth/auth.controller.ts`):

| 표준 | PKCE |
|------|------|
| `GET /auth/google` → `/auth/google/callback` | `GET /auth/google/pkce` → `/auth/google/pkce/callback` |
| `GET /auth/kakao` → `/auth/kakao/callback` | `GET /auth/kakao/pkce` → `/auth/kakao/pkce/callback` |
| `GET /auth/naver` → `/auth/naver/callback` | `GET /auth/naver/pkce` → `/auth/naver/pkce/callback` |

**프로바이더 콘솔에서 등록할 redirect URI** 는 `*_CALLBACK_URL` / `*_PKCE_CALLBACK_URL` 환경변수와 정확히 일치해야 함.

**Kakao 닉네임 scope**: 카카오 비즈니스 채널 등록 필요 (단순 `profile_nickname` 만으로는 일부 계정에서 권한 거부).

---

## 9. Kakao Map REST API (LocationModule)

**용도**: 키워드 / 주소 / 역지오코딩 검색.

**API 키**: `KAKAO_MAP_API`

**엔드포인트** (`src/location/location.controller.ts`):
- `GET /locations/keyword` — 키워드 검색
- `GET /locations/address` — 주소 → 좌표
- `GET /locations/coord2address` — 좌표 → 주소

---

## 10. Gmail SMTP (이메일 인증)

**클라이언트**: `nodemailer` `service: 'gmail'` (`src/mail/mail.service.ts`).

**자격증명**: `MAIL_USER` (Gmail 주소) + `MAIL_PASS` (Google 계정의 **앱 비밀번호**, 일반 비밀번호 X).

**용도**: 이메일 인증 코드 발송. 자세한 흐름은 [modules/mail.md](modules/mail.md).

---

## 11. Sentry (에러 추적)

**활성 조건**: `NODE_ENV=production` AND `SENTRY_DSN` 존재 (`src/main.ts`).

**SDK**: `@sentry/nestjs`. `SentryInterceptor` (`src/common/interceptors/sentry.interceptor.ts`) 가 전역 등록되어 모든 컨트롤러 예외 캡처.

**샘플레이트**: `SENTRY_TRACES_SAMPLE_RATE` (기본 `0.1`).

---

## 12. AWS — EC2 IAM 인스턴스 프로파일

**용도**: 컨테이너 안에서 `aws` CLI 자동 자격증명 (Access Key 불필요).

**역할**: `Ddareungimap_EC2_S3_Uploader`

**부착된 정책**:
- `AmazonS3FullAccess` — 배포 산출물 다운로드 (`ddareungimap-deploy-artifacts-...`)
- `AmazonSSMManagedInstanceCore` — SSM Agent 통신
- `SecretsManagerReadWrite` — (예약. 현재 코드 미사용)
- 커스텀 `ddareungimap-tts` — EC2/IAM 메타데이터 조회

**현재 코드에서 사용 중**: S3 (배포 산출물 다운로드), SSM (관리 채널). Secrets Manager·기타 AWS SDK 직접 호출은 코드에 없음.
