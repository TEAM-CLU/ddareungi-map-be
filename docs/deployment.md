# 운영 / 배포

## 인프라 식별자

| 항목 | 값 |
|------|----|
| EC2 instance | `i-0349ea5cf82643001` (`43.200.11.89`, ap-northeast-2) |
| EC2 IAM role | `Ddareungimap_EC2_S3_Uploader` |
| Security group | `sg-06c8bffbc5df9ba90` (`launch-wizard-2`) |
| 도메인 | `ddareungimap.com`, `ssumpick.com` (호스트 Nginx + Let's Encrypt) |
| 배포 산출물 버킷 | `s3://ddareungimap-deploy-artifacts-586110264746` (lifecycle 7일) |
| CI 자격증명 | IAM User `ddareungimap-tts` Access Key |

## 보안그룹 인바운드

| 포트 | Source | 설명 |
|------|--------|------|
| 80 | 0.0.0.0/0 | Nginx (HTTPS 리다이렉트) |
| 443 | 0.0.0.0/0 | Nginx |

22 / 6379 / 8989 는 폐쇄. EC2 접속은 SSM Session Manager로만.

## 일상 운영

### EC2 접속

```bash
# 인터랙티브 셸 (mac에서)
aws ssm start-session --target i-0349ea5cf82643001 --region ap-northeast-2
# → ssm-user 셸. sudo -i 로 root, 또는 sudo -u ubuntu

# 일회성 명령
CMD_ID=$(aws ssm send-command --instance-ids i-0349ea5cf82643001 \
  --document-name AWS-RunShellScript --region ap-northeast-2 \
  --parameters 'commands=["sudo -u ubuntu docker compose -f /home/ubuntu/ddareungi-map-be/docker-compose.yml ps"]' \
  --query 'Command.CommandId' --output text)
aws ssm get-command-invocation --command-id "$CMD_ID" \
  --instance-id i-0349ea5cf82643001 --region ap-northeast-2 \
  --query StandardOutputContent --output text
```

### 컨테이너 명령 (EC2 안에서, `cd /home/ubuntu/ddareungi-map-be`)

```bash
# 상태 / 로그 / 헬스
docker compose ps
docker compose logs --tail 100 nestjs
docker inspect -f '{{.State.Health.Status}}' ddareungimap-api
curl -fsS http://localhost:3000/health

# NestJS만 무중단 재배포 (CI가 하는 일과 동일)
docker compose build nestjs
docker compose up -d --no-deps --force-recreate nestjs

# 환경변수 변경 후 재기동
docker compose up -d --force-recreate nestjs

# 디스크 정리
docker image prune -f
docker builder prune -af
```

### Redis / GraphHopper 접근

```bash
docker exec -it ddareungimap-redis redis-cli
docker exec ddareungimap-redis redis-cli KEYS '*' | head

curl -s http://localhost:8989/health
curl -s "http://localhost:8989/route?point=37.5665,126.9780&point=37.5172,127.0473&profile=safe_bike&locale=ko"
```

## CI/CD

`dev` 브랜치 push 시 `.github/workflows/deploy.yml`:

1. 소스 tar (`src`, `public`, `Dockerfile`, `docker-compose.yml`, `scripts/deploy-on-ec2.sh`, 설정 파일)
2. S3 업로드 (`s3://ddareungimap-deploy-artifacts-.../<sha>-<run>.tar.gz`)
3. `aws ssm send-command` → EC2가 산출물 받아 `scripts/deploy-on-ec2.sh` 실행
4. 5초 폴링으로 결과 대기 (최대 7.5분)

### 필요한 GitHub Secrets

`TEAM-CLU/ddareungi-map-be` → Settings → Secrets and variables → Actions:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

### CI 자격증명용 IAM 정책 (`ddareungimap-tts` user 인라인)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket","s3:PutBucketPublicAccessBlock",
        "s3:PutLifecycleConfiguration","s3:GetBucketLocation",
        "s3:GetBucketLifecycleConfiguration","s3:GetBucketPublicAccessBlock",
        "s3:ListBucket","s3:PutObject","s3:GetObject","s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::ddareungimap-deploy-artifacts-586110264746",
        "arn:aws:s3:::ddareungimap-deploy-artifacts-586110264746/*"
      ]
    },
    { "Effect":"Allow","Action":["s3:ListAllMyBuckets","s3:HeadBucket"],"Resource":"*" },
    {
      "Effect":"Allow",
      "Action":["ssm:DescribeInstanceInformation","ssm:ListCommands","ssm:ListCommandInvocations","ssm:GetCommandInvocation","ssm:CancelCommand","ssm:StartSession","ssm:TerminateSession","ssm:GetConnectionStatus"],
      "Resource":"*"
    },
    {
      "Effect":"Allow",
      "Action":"ssm:SendCommand",
      "Resource":[
        "arn:aws:ec2:ap-northeast-2:586110264746:instance/i-0349ea5cf82643001",
        "arn:aws:ssm:*:*:document/AWS-RunShellScript"
      ]
    }
  ]
}
```

### EC2 인스턴스 역할에 부착돼 있어야 할 정책

| 정책 | 용도 |
|------|------|
| `AmazonS3FullAccess` | 배포 시 S3 산출물 다운로드 |
| `AmazonSSMManagedInstanceCore` | SSM Agent ↔ AWS 통신 |
| `SecretsManagerReadWrite` | (예약 — 현재 코드 미사용) |
| 커스텀 `ddareungimap-tts` | EC2/IAM 메타데이터 조회 (디버깅) |

## 롤백

이전 이미지로 즉시 되돌리려면 빌드 시점에 태그 보존:

```bash
# 배포 직전
docker tag ddareungimap-api:latest ddareungimap-api:rollback

# 문제 발생 시
docker tag ddareungimap-api:rollback ddareungimap-api:latest
docker compose up -d --no-deps --force-recreate nestjs
```

## 트러블슈팅

### NestJS 컨테이너 재시작 반복

```bash
docker logs --tail 100 ddareungimap-api
```

흔한 원인:
- `.env.production`의 외부 자격증명 만료 (Supabase pooler `tenant/user not found` 등)
- GCP 키 JSON 마운트 누락 → `Google TTS 인증 파일을 찾을 수 없습니다`

컨테이너 내부에서 의존성 도달 가능 여부:

```bash
docker exec ddareungimap-api node -e \
  'require("net").createConnection(6379,"redis",()=>{console.log("OK");process.exit()}).on("error",e=>{console.log("FAIL",e.message);process.exit(1)})'
docker exec ddareungimap-api curl -fsS http://graphhopper:8989/health
```

### GraphHopper OOM

`docker-compose.yml` 의 `command`에서 `-Xmx2g` 조정. 현재 인스턴스 RAM 4GB라 2GB 이상 주면 다른 컨테이너가 OOMKill 위험.

### 디스크 부족

```bash
df -h /
docker system df
docker builder prune -af
docker image prune -af
sudo journalctl --vacuum-time=3d
```

CI 워크플로우는 1GB 미만이면 빌드 거부 + 매 배포 후 `docker image prune -f` 자동 수행.

### Nginx 502 Bad Gateway

`127.0.0.1:3000` 에 NestJS 컨테이너가 안 떠 있는 경우.

```bash
docker compose ps           # nestjs healthy 인지
sudo ss -tlnp | grep 3000   # 호스트 바인딩
curl -fsS http://localhost:3000/health
```

### Redis 데이터 백업

```bash
docker run --rm -v ddareungimap_redis-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/redis-$(date +%F).tgz -C /data .
```
