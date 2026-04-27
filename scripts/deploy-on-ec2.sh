#!/usr/bin/env bash
# EC2에서 SSM SendCommand로 호출되는 배포 스크립트
# 호출 측에서 ARTIFACT, S3_BUCKET, APP_DIR 환경변수 주입
#
# 동작:
#   1) 디스크 가드 (1GB 미만이면 거부)
#   2) S3에서 산출물 다운로드 → 앱 디렉터리에 풀기
#   3) docker compose로 nestjs 컨테이너만 무중단 교체
#   4) 60초 헬스체크 대기 (실패 시 로그 출력 + exit 1)
#   5) 미사용 이미지 prune

set -euo pipefail

ARTIFACT="${ARTIFACT:?ARTIFACT env required}"
S3_BUCKET="${S3_BUCKET:?S3_BUCKET env required}"
APP_DIR="${APP_DIR:?APP_DIR env required}"

echo "== 디스크 가드 =="
AVAIL_KB=$(df -k / | awk 'NR==2 {print $4}')
if [ "$AVAIL_KB" -lt 1048576 ]; then
  echo "ERROR: insufficient disk (<1GB free)"
  df -h /
  exit 1
fi

echo "== 1. S3에서 산출물 다운로드 =="
cd /tmp
aws s3 cp "s3://$S3_BUCKET/$ARTIFACT" "$ARTIFACT"

echo "== 2. 앱 디렉터리에 압축 해제 =="
mkdir -p "$APP_DIR"
tar -xzf "$ARTIFACT" -C "$APP_DIR"
rm -f "$ARTIFACT"
chown -R ubuntu:ubuntu "$APP_DIR"

cd "$APP_DIR"

echo "== 3. NestJS 컨테이너 빌드 + 교체 =="
sudo -u ubuntu docker compose build nestjs
sudo -u ubuntu docker compose up -d --no-deps --force-recreate nestjs

echo "== 4. 헬스체크 60초 대기 =="
for i in $(seq 1 30); do
  STATUS=$(sudo -u ubuntu docker inspect -f '{{.State.Health.Status}}' ddareungimap-api 2>/dev/null || echo none)
  if [ "$STATUS" = "healthy" ]; then
    echo "nestjs healthy"
    break
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "ERROR: nestjs unhealthy after 60s"
    sudo -u ubuntu docker logs --tail 80 ddareungimap-api
    exit 1
  fi
done

echo "== 5. 미사용 이미지 정리 =="
sudo -u ubuntu docker image prune -f

echo "DEPLOY_OK"
