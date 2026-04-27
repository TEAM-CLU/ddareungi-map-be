# Docker 기반 배포 가이드

따릉이맵 백엔드(NestJS) + Redis + GraphHopper를 EC2 단일 인스턴스에서 Docker Compose로 운영하는 방식입니다.

- **EC2**: `43.200.11.89` (ap-northeast-2, t3.medium 급, 2 vCPU / 3.8GB RAM / 15GB disk)
- **OS**: Ubuntu 24.04, Docker 28.x + Compose v2
- **앞단**: 호스트 Nginx (TLS, 리버스 프록시) — 컨테이너화 안 함

---

## 1. 아키텍처

```
                  Internet (443)
                       │
                       ▼
              [ Host Nginx (systemd) ]   ← /etc/letsencrypt 인증서
                       │ proxy_pass
                       ▼
              127.0.0.1:3000 (호스트 루프백)
                       │
                       ▼
   ┌─────────────── Docker Network: ddareungimap_default ───────────────┐
   │                                                                    │
   │   [ ddareungimap-api ]   ──http→  [ ddareungimap-gh    ] :8989    │
   │       NestJS (Node 24)             GraphHopper (Java 17)           │
   │             │                                                      │
   │             └────tcp────►  [ ddareungimap-redis ] :6379            │
   │                              Redis 7 (AOF, named volume)           │
   └────────────────────────────────────────────────────────────────────┘
```

**왜 단일 NestJS 컨테이너인가**

PM2 cluster를 컨테이너 안에서 돌리는 대신 단일 Node 프로세스 + 컨테이너 1개로 운영합니다.
이유: ① Docker `restart: always` + healthcheck가 PM2 watchdog 역할을 대체, ② `docker logs`로 stdout이 그대로 보임, ③ SIGTERM이 가로채는 계층이 없어 graceful shutdown이 깔끔, ④ 향후 트래픽 증가 시 `docker compose up --scale nestjs=N` + nginx upstream으로 수평 확장 가능.

---

## 2. 파일 구성

| 위치 | 설명 |
|------|------|
| `Dockerfile` | NestJS 멀티스테이지 빌드 (node:24-alpine, pnpm corepack, tini) |
| `.dockerignore` | 빌드 컨텍스트 축소 + 시크릿(`*.pem`, `.env*`) 차단 |
| `docker-compose.yml` | nestjs / redis / graphhopper 3 서비스 정의 |
| `.github/workflows/deploy.yml` | dev 브랜치 push 시 EC2로 소스 전송 → compose build/up |
| `src/app.controller.ts` | `GET /health` (도커 healthcheck용) |

EC2에서만 존재하는 파일

| 위치 | 설명 |
|------|------|
| `/home/ubuntu/ddareungi-map-be/.env.production` | 운영 환경변수 (git 제외) |
| `/home/ubuntu/graph-cache/` | GraphHopper CH 사전계산 그래프 (~600MB, 호스트 바인드 마운트) |
| `/home/ubuntu/graphhopper-server/` | GraphHopper 이미지 빌드 컨텍스트 (jar + OSM pbf + 커스텀 모델) |
| Docker named volume `ddareungimap_redis-data` | Redis AOF/RDB 영속 데이터 |

---

## 3. 환경변수 정리

`.env.production`에서 컨테이너 통신용으로 반드시 다음 값을 사용합니다.

```env
NODE_ENV=production
PORT=3000

# 컨테이너 간 통신은 docker compose 서비스명을 호스트로 사용
REDIS_HOST=redis
REDIS_PORT=6379
GRAPHHOPPER_URL=http://graphhopper:8989
```

> **주의**: `REDIS_HOST=localhost` / `GRAPHHOPPER_URL=http://localhost:8989`로 두면 컨테이너 안에서는 자기 자신을 가리켜 연결이 실패합니다.

호스트(EC2 셸)에서 직접 디버깅할 때는 다음 포트가 노출되어 있습니다.

| 서비스 | 호스트 포트 | 노출 범위 |
|--------|-------------|----------|
| NestJS | `127.0.0.1:3000` | 루프백만 (Nginx만 접근) |
| GraphHopper | `0.0.0.0:8989` | 외부 (보안그룹에서 IP 제한 권장) |
| Redis | (외부 노출 없음) | 컨테이너 네트워크 내부만 |

---

## 4. 최초 1회 부트스트랩 (이미 완료된 절차)

이미 `43.200.11.89`에서 완료된 절차이며, 신규 인스턴스 구축 시 그대로 재사용합니다.

```bash
# 0) 디스크 점검 (3GB 이상 권장)
df -h /

# 1) Docker + Compose plugin
sudo apt-get install -y docker.io
mkdir -p ~/.docker/cli-plugins/
curl -SL https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64 \
  -o ~/.docker/cli-plugins/docker-compose
chmod +x ~/.docker/cli-plugins/docker-compose
sudo usermod -aG docker $USER && newgrp docker

# 2) GraphHopper 이미지 준비 (한 번만, 약 30분)
#    OSM pbf + jar + custom_models가 들어있는 디렉터리에서 빌드
cd /home/ubuntu/graphhopper-server
docker build -t local/ddareungimap-gh:latest .

# 3) 그래프 캐시 디렉터리
mkdir -p /home/ubuntu/graph-cache  # 컨테이너가 첫 실행 시 자동 빌드 (~10분)

# 4) 앱 디렉터리에 .env.production 배치 (REDIS_HOST=redis, GRAPHHOPPER_URL=http://graphhopper:8989)
cd /home/ubuntu/ddareungi-map-be
vim .env.production

# 5) 기동
docker compose up -d
docker compose ps
```

**기존 systemd Redis에서 옮기는 경우**

```bash
sudo redis-cli SAVE
sudo cp /var/lib/redis/dump.rdb /tmp/redis-dump.rdb
sudo systemctl stop redis-server && sudo systemctl disable redis-server

docker compose up -d redis
docker cp /tmp/redis-dump.rdb ddareungimap-redis:/data/dump.rdb
docker compose restart redis
```

---

## 5. 일상 운영 명령

```bash
cd /home/ubuntu/ddareungi-map-be

# 상태
docker compose ps
docker stats --no-stream

# 로그 (-f로 실시간)
docker compose logs --tail 100 nestjs
docker compose logs --tail 100 graphhopper
docker compose logs --tail 100 redis

# 헬스 상태
docker inspect -f '{{.State.Health.Status}}' ddareungimap-api
curl -fsS http://localhost:3000/health

# NestJS만 새 코드로 무중단 재배포 (CI가 하는 일과 동일)
docker compose build nestjs
docker compose up -d --no-deps --force-recreate nestjs

# 전체 재기동
docker compose restart
docker compose down && docker compose up -d

# 환경변수 변경 후 적용
docker compose up -d --force-recreate nestjs

# 디스크 정리 (이미지 + 빌드 캐시)
docker image prune -f
docker builder prune -af
```

### Redis 데이터 접근

```bash
# 컨테이너 안에서 redis-cli
docker exec -it ddareungimap-redis redis-cli

# 호스트 → 컨테이너 (포트 노출 안 했으므로 docker exec 사용)
docker exec ddareungimap-redis redis-cli KEYS '*' | head
```

### GraphHopper 검증

```bash
# 호스트에서
curl -s http://localhost:8989/health
curl -s "http://localhost:8989/route?point=37.5665,126.9780&point=37.5172,127.0473&profile=safe_bike&locale=ko" | head -c 400

# 컨테이너에서
docker exec ddareungimap-api curl -fsS http://graphhopper:8989/health
```

---

## 6. CI/CD 동작 (`.github/workflows/deploy.yml`)

`dev` 브랜치 push 시 (SSM 기반 — SSH 22 폐쇄 환경):

1. `actions/checkout` → 소스 받기
2. `aws-actions/configure-aws-credentials` → AWS 자격증명 로드
3. 빌드 컨텍스트 (`src/`, `Dockerfile`, `docker-compose.yml`, `scripts/deploy-on-ec2.sh` 등) tar로 패키징
4. **S3 버킷 (`ddareungimap-deploy-artifacts-586110264746`) 업로드** (7일 lifecycle 자동 만료)
5. **SSM SendCommand**로 EC2에 배포 트리거: S3 다운로드 → 압축 해제 → `scripts/deploy-on-ec2.sh` 실행
6. 5초 간격으로 SSM command 결과 폴링 (최대 7.5분)
7. EC2 측 스크립트가: `docker compose build nestjs` → `up -d --no-deps --force-recreate` → 60초 healthcheck → `docker image prune -f`

**필요한 GitHub Secrets** (Repo: `TEAM-CLU/ddareungi-map-be` → Settings → Secrets and variables → Actions):
- `AWS_ACCESS_KEY_ID` — IAM User `ddareungimap-tts`의 access key
- `AWS_SECRET_ACCESS_KEY` — 같은 사용자의 secret access key

기존 `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`는 더 이상 사용하지 않음 (삭제 가능).

**필요한 IAM 권한 (mac/CI 공용 IAM User `ddareungimap-tts`의 인라인 정책 `DeployAutomation`)**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket", "s3:PutBucketPublicAccessBlock",
        "s3:PutLifecycleConfiguration", "s3:GetBucketLocation",
        "s3:GetBucketLifecycleConfiguration", "s3:GetBucketPublicAccessBlock",
        "s3:ListBucket", "s3:PutObject", "s3:GetObject", "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::ddareungimap-deploy-artifacts-586110264746",
        "arn:aws:s3:::ddareungimap-deploy-artifacts-586110264746/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListAllMyBuckets", "s3:HeadBucket"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:DescribeInstanceInformation", "ssm:ListCommands",
        "ssm:ListCommandInvocations", "ssm:GetCommandInvocation",
        "ssm:CancelCommand"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ec2:ap-northeast-2:586110264746:instance/i-0349ea5cf82643001",
        "arn:aws:ssm:*:*:document/AWS-RunShellScript"
      ]
    }
  ]
}
```

EC2 instance role(`Ddareungimap_EC2_S3_Uploader`)은 다음 정책 필요 (이미 부착됨):
- `AmazonS3FullAccess` — S3에서 산출물 다운로드
- `AmazonSSMManagedInstanceCore` — SSM Agent 등록

**EC2 접속 (SSH 대신 SSM)**

```bash
# 셸 진입
aws ssm start-session --target i-0349ea5cf82643001 --region ap-northeast-2

# 일회성 명령 실행
aws ssm send-command --instance-ids i-0349ea5cf82643001 \
  --document-name AWS-RunShellScript --region ap-northeast-2 \
  --parameters 'commands=["sudo -u ubuntu docker compose -f /home/ubuntu/ddareungi-map-be/docker-compose.yml ps"]' \
  --query 'Command.CommandId' --output text
# → 결과 확인:
aws ssm get-command-invocation --command-id <위에서 받은 ID> \
  --instance-id i-0349ea5cf82643001 --region ap-northeast-2 \
  --query StandardOutputContent --output text
```

**기존 PM2/SSH 흐름과의 차이**

| 단계 | 이전 (PM2 + SSH) | 현재 (Docker + SSM) |
|------|-----------|---------------|
| 빌드 위치 | GH Actions에서 빌드 → dist 전송 | EC2 컨테이너 내부 빌드 |
| 의존성 | EC2에서 `pnpm install --prod` | Docker 빌드 단계에서 1회만 |
| 전송 채널 | scp via SSH 22 | S3 업로드 + SSM SendCommand |
| EC2 SSH 22 | 0.0.0.0/0 열림 (위험) | **완전 폐쇄** (보안그룹에서 삭제) |
| 재기동 | `pm2 reload` | `docker compose up -d --force-recreate` |
| 헬스체크 | 없음 | 60초 내 `/health` 통과 강제 |
| 롤백 | 수동 | 이전 이미지 태그 사용 (아래 참조) |
| 감사 로그 | 없음 | CloudTrail에 모든 SSM 호출 기록 |

---

## 7. 롤백

새 이미지가 문제일 때 즉시 이전 이미지로 되돌리려면 빌드 시점에 태그를 남겨두는 것이 가장 빠릅니다.

```bash
# 배포 전에 현재 이미지 태그 보존
docker tag ddareungimap-api:latest ddareungimap-api:rollback

# 문제 발생 시
docker tag ddareungimap-api:rollback ddareungimap-api:latest
docker compose up -d --no-deps --force-recreate nestjs
```

(추후 ECR/Docker Hub로 이미지 레지스트리를 도입하면 `:vYYYYMMDD-HHMM` 태그로 더 깔끔하게 관리할 수 있습니다.)

---

## 8. 트러블슈팅

### 8-1. NestJS 컨테이너가 계속 재시작

```bash
docker logs --tail 100 ddareungimap-api
```

가장 흔한 원인은 `.env.production`의 외부 의존성(특히 Supabase Postgres) 자격증명 만료. 컨테이너 안에서 호스트네임 해석 자체는 다음으로 확인:

```bash
docker exec ddareungimap-api node -e \
  'require("net").createConnection(6379,"redis",()=>{console.log("OK");process.exit()}).on("error",e=>{console.log("FAIL",e.message);process.exit(1)})'
```

### 8-2. GraphHopper가 그래프 빌드 중 OOM

`docker-compose.yml`의 `command`에서 `-Xmx2g`를 환경에 맞게 조정. EC2 메모리가 4GB라 2GB 이상 주면 다른 컨테이너가 OOMKill될 위험. `nestjs`에 `mem_limit: 1g` 추가도 검토.

### 8-3. 디스크 부족

```bash
df -h /
docker system df
docker builder prune -af
docker image prune -af
sudo journalctl --vacuum-time=3d
```

빌드 캐시가 빠르게 1~2GB 쌓이므로 디스크가 빠듯한 인스턴스는 매 배포마다 prune 권장 (CI가 자동 수행).

### 8-4. Nginx 502 Bad Gateway

`127.0.0.1:3000`에 NestJS 컨테이너가 안 떠 있는 경우.

```bash
docker compose ps           # nestjs가 healthy인지
sudo ss -tlnp | grep 3000   # 호스트 포트 바인딩 확인
curl -fsS http://localhost:3000/health
```

### 8-5. Redis 데이터 손실 의심

영속 볼륨 위치:

```bash
docker volume inspect ddareungimap_redis-data
# Mountpoint 경로의 dump.rdb / appendonlydir/ 확인
```

볼륨 백업:

```bash
docker run --rm -v ddareungimap_redis-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/redis-$(date +%F).tgz -C /data .
```

---

## 9. 보안 체크리스트

- [ ] EC2 보안그룹: 22(특정 IP), 80/443(0.0.0.0/0), 8989(특정 IP만 또는 비공개) — Redis는 컨테이너 외부 노출 없음
- [ ] `.env.production`은 `chmod 600`, git 추적 제외 (`.gitignore` 등록 확인)
- [ ] `.dockerignore`로 `*.pem`, `.env*`, GCP 키 JSON 빌드 컨텍스트에서 제외
- [ ] NestJS 컨테이너 비루트 사용자(`nodeapp`) 실행
- [ ] tini로 PID 1 시그널 처리 → SIGTERM 시 graceful shutdown
- [ ] Nginx에서 IP 직접 접속(`Host: _`)은 444로 차단

---

## 10. 향후 개선 후보

- **이미지 레지스트리**: GHCR 또는 ECR로 이미지를 push → EC2는 pull만. CI 빌드 시간 단축 + 롤백 명료화.
- **수평 확장**: 트래픽 증가 시 `docker compose up --scale nestjs=2` + nginx upstream(라운드로빈)으로 무중단 멀티프로세스화.
- **GraphHopper 외주화**: OSM 빌드/캐시는 메모리·디스크 부담이 크므로 별도 인스턴스 또는 ECS로 분리 검토.
- **CloudWatch 로그**: `awslogs` driver로 컨테이너 로그를 CloudWatch에 전송 (현재는 EC2 디스크 json-file).
