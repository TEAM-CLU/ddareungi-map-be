# syntax=docker/dockerfile:1.7
# 멀티스테이지 빌드 - 최종 이미지 크기 최소화

# ===== 1단계: 빌드 =====
FROM node:24-alpine AS builder

# pnpm 활성화 (corepack)
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# 의존성 메타만 먼저 복사해 캐시 적중률 향상
COPY package.json pnpm-lock.yaml ./

# 빌드용 dev 의존성 포함 설치
RUN pnpm install --frozen-lockfile

# 소스 복사 후 빌드
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm run build

# 운영 의존성만 별도 폴더로 추출 (최종 이미지에 복사)
RUN pnpm install --prod --frozen-lockfile --ignore-scripts \
  && pnpm prune --prod

# ===== 2단계: 런타임 =====
FROM node:24-alpine AS runner

# tini: PID 1 시그널 처리, curl: healthcheck용
RUN apk add --no-cache tini curl

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# 빌드 산출물 + 운영 node_modules + 정적 파일만 복사
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY public ./public

# root가 아닌 사용자로 실행
RUN addgroup -S nodeapp && adduser -S nodeapp -G nodeapp \
  && chown -R nodeapp:nodeapp /app
USER nodeapp

EXPOSE 3000

# tini로 SIGTERM/SIGINT를 정확히 node로 전달 → graceful shutdown
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
