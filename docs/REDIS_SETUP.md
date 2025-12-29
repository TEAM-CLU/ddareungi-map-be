# Redis 설정 가이드

네비게이션 세션, TTS 캐시, 경로 데이터 저장을 위한 Redis 서버 설정 가이드입니다.

## 📋 개요

- **제공**: Redis (오픈소스 in-memory 데이터베이스)
- **용도**: 세션 관리, 캐싱, 임시 데이터 저장
- **사용 모듈**: `navigation`, `tts`, `routes` 모듈
- **데이터 유형**: String (JSON 직렬화)

## 🏗️ 데이터 구조

### 1. 네비게이션 세션
```
키: navigation:session:{sessionId}
값: {
  sessionId, routeId, userId, startedAt,
  currentIndex, status, ...
}
TTL: 600초 (10분)
```

### 2. 경로 데이터
```
키: route:{routeId}
값: {
  coordinates, instructions, summary, ...
}
TTL: 3600초 (1시간)
```

### 3. TTS 캐시
```
키: tts:phrase:{hash}
값: {
  text, textKo, s3Url, status, ...
}
TTL: 2592000초 (30일) 또는 315360000초 (10년)
```

## 📦 설치 방법

### 방법 1: Docker로 설치 (권장)

#### docker-compose.yml

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    container_name: ddareungi-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes --requirepass your-password
    restart: unless-stopped

volumes:
  redis-data:
    driver: local
```

#### 실행

```bash
# 시작
docker-compose up -d redis

# 중지
docker-compose down

# 로그 확인
docker logs -f ddareungi-redis
```

### 방법 2: 직접 설치

#### Ubuntu/EC2

```bash
# Redis 설치
sudo apt update
sudo apt install redis-server -y

# 설정 파일 편집
sudo nano /etc/redis/redis.conf
```

**설정 변경**:
```conf
# 외부 접속 허용
bind 0.0.0.0

# 비밀번호 설정
requirepass your-strong-password

# 백그라운드 실행
daemonize yes

# 데이터 지속성
appendonly yes
appendfilename "appendonly.aof"

# 메모리 제한 (예: 1GB)
maxmemory 1gb
maxmemory-policy allkeys-lru
```

#### 서비스 관리

```bash
# 시작
sudo systemctl start redis-server

# 중지
sudo systemctl stop redis-server

# 재시작
sudo systemctl restart redis-server

# 부팅 시 자동 시작
sudo systemctl enable redis-server

# 상태 확인
sudo systemctl status redis-server
```

#### macOS (Homebrew)

```bash
# Redis 설치
brew install redis

# 시작
brew services start redis

# 중지
brew services stop redis

# 상태 확인
brew services list
```

## ⚙️ 환경 설정

### 환경 설정 (`.env`)

```env
# Redis 서버 설정
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password  # 선택사항

# 로컬 개발 시
# REDIS_HOST=localhost
```

> 📝 **구성**: Redis 서버를 EC2 또는 로컬에서 실행하고 해당 호스트를 설정하세요.
> 🔒 **보안**: 프로덕션 환경에서는 반드시 `requirepass`로 비밀번호를 설정하세요.
> 🌐 **접근**: EC2 보안 그룹에서 6379 포트를 신뢰하는 IP에만 허용하세요.

## 💻 코드 구현

### Redis 모듈 설정

**위치**: `src/app.module.ts`

```typescript
import { RedisModule } from '@liaoliaots/nestjs-redis';

@Module({
  imports: [
    RedisModule.forRoot({
      config: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD,
      },
    }),
  ],
})
export class AppModule {}
```

### Redis 사용 예시

#### 1. NavigationSessionService

```typescript
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { Redis } from 'ioredis';

@Injectable()
export class NavigationSessionService {
  private readonly redis: Redis;

  constructor(private readonly redisService: RedisService) {
    this.redis = this.redisService.getOrThrow();
  }

  // 세션 저장
  async saveSession(sessionId: string, data: NavigationSession): Promise<void> {
    const key = `navigation:session:${sessionId}`;
    await this.redis.setex(key, 600, JSON.stringify(data)); // 10분 TTL
  }

  // 세션 조회
  async getSession(sessionId: string): Promise<NavigationSession | null> {
    const key = `navigation:session:${sessionId}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  // 세션 삭제
  async deleteSession(sessionId: string): Promise<void> {
    const key = `navigation:session:${sessionId}`;
    await this.redis.del(key);
  }
}
```

#### 2. TtsService

```typescript
@Injectable()
export class TtsService {
  private readonly redis: Redis;
  private readonly REDIS_PREFIX = 'tts:phrase:';
  private readonly REDIS_TTL = 86400 * 30; // 30일

  constructor(private readonly redisService: RedisService) {
    this.redis = this.redisService.getOrThrow();
  }

  // TTS 캐시 저장
  async cacheT ts(hash: string, record: TtsRecord): Promise<void> {
    const key = `${this.REDIS_PREFIX}${hash}`;
    await this.redis.setex(key, this.REDIS_TTL, JSON.stringify(record));
  }

  // TTS 캐시 조회
  async lookupTts(hash: string): Promise<TtsRecord | null> {
    const key = `${this.REDIS_PREFIX}${hash}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }
}
```

## 🧪 테스트

### redis-cli로 테스트

```bash
# Redis 접속
redis-cli

# 비밀번호 인증 (필요한 경우)
AUTH your-password

# 키 저장
SET test:key "Hello Redis"

# 키 조회
GET test:key

# TTL 설정 (10초)
SETEX test:ttl 10 "Expires in 10 seconds"

# TTL 확인
TTL test:ttl

# 모든 키 조회
KEYS *

# 특정 패턴 키 조회
KEYS navigation:session:*

# 키 삭제
DEL test:key

# 데이터베이스 비우기 (주의!)
FLUSHDB
```

### 애플리케이션 테스트

```bash
# 로컬 서버 실행
pnpm run start:local

# 네비게이션 시작 (세션 생성)
curl -X POST "http://localhost:3000/navigation/start" \
  -H "Content-Type: application/json" \
  -d '{
    "routeId": "test-route-123",
    "currentLocation": {"lat": 37.5665, "lng": 126.9780}
  }'

# Redis에서 확인
redis-cli
KEYS navigation:session:*
GET navigation:session:{sessionId}
```

## 📊 데이터 모니터링

### Redis CLI 모니터링

```bash
# 실시간 명령어 모니터링
redis-cli MONITOR

# 메모리 사용량 확인
redis-cli INFO memory

# 키 통계 확인
redis-cli INFO keyspace

# 연결 클라이언트 확인
redis-cli CLIENT LIST
```

### Node.js 모니터링 코드

```typescript
// Redis 상태 확인
const info = await this.redis.info('memory');
console.log(info);

// 키 개수 확인
const sessionKeys = await this.redis.keys('navigation:session:*');
console.log(`Active sessions: ${sessionKeys.length}`);

// 특정 키의 TTL 확인
const ttl = await this.redis.ttl('navigation:session:abc123');
console.log(`Session TTL: ${ttl} seconds`);
```

## 🔧 EC2 배포

### 1. Redis 설치 스크립트

```bash
#!/bin/bash

# Redis 설치
sudo apt update
sudo apt install redis-server -y

# 설정 백업
sudo cp /etc/redis/redis.conf /etc/redis/redis.conf.backup

# 설정 변경
sudo sed -i 's/bind 127.0.0.1 ::1/bind 0.0.0.0/' /etc/redis/redis.conf
sudo sed -i 's/# requirepass foobared/requirepass YourStrongPassword123!/' /etc/redis/redis.conf
echo "appendonly yes" | sudo tee -a /etc/redis/redis.conf
echo "maxmemory 1gb" | sudo tee -a /etc/redis/redis.conf
echo "maxmemory-policy allkeys-lru" | sudo tee -a /etc/redis/redis.conf

# Redis 재시작
sudo systemctl restart redis-server
sudo systemctl enable redis-server

# 상태 확인
sudo systemctl status redis-server

# 방화벽 설정 (선택 사항)
sudo ufw allow 6379/tcp

echo "Redis installation completed!"
```

### 2. 보안 그룹 설정 (AWS)

**인바운드 규칙**:
- **유형**: Custom TCP
- **포트**: 6379
- **소스**: Backend API 서버 보안 그룹 또는 특정 IP

### 3. systemd 서비스 확인

```bash
# 서비스 파일 위치
/lib/systemd/system/redis-server.service

# 서비스 재로드
sudo systemctl daemon-reload

# 부팅 시 자동 시작
sudo systemctl enable redis-server
```

## ⚠️ 트러블슈팅

### 1. 연결 거부 (ECONNREFUSED)

**증상**:
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**해결**:
1. Redis 서버 실행 상태 확인:
```bash
sudo systemctl status redis-server
```

2. Redis 프로세스 확인:
```bash
ps aux | grep redis
```

3. 포트 리스닝 확인:
```bash
sudo netstat -tlnp | grep 6379
```

4. 재시작:
```bash
sudo systemctl restart redis-server
```

### 2. 인증 실패 (NOAUTH)

**증상**:
```
ReplyError: NOAUTH Authentication required
```

**해결**:
1. `.env` 파일에 `REDIS_PASSWORD` 추가
2. Redis 설정에서 `requirepass` 확인:
```bash
sudo grep "requirepass" /etc/redis/redis.conf
```

### 3. 메모리 부족 (OOM)

**증상**:
```
ReplyError: OOM command not allowed when used memory > 'maxmemory'
```

**해결**:
1. 메모리 사용량 확인:
```bash
redis-cli INFO memory | grep used_memory_human
```

2. `maxmemory` 증가:
```bash
sudo nano /etc/redis/redis.conf
# maxmemory 2gb
sudo systemctl restart redis-server
```

3. 만료 정책 확인:
```bash
redis-cli CONFIG GET maxmemory-policy
# allkeys-lru 권장
```

### 4. 외부 접속 불가

**증상**:
- 로컬에서는 작동하지만 원격 접속 안 됨

**해결**:
1. `bind` 설정 확인:
```bash
sudo grep "^bind" /etc/redis/redis.conf
# bind 0.0.0.0 (외부 접속 허용)
```

2. 방화벽 확인:
```bash
sudo ufw status
sudo ufw allow 6379/tcp
```

3. AWS 보안 그룹 6379 포트 허용 확인

### 5. 데이터 지속성 문제

**증상**:
- 재시작 후 데이터 사라짐

**해결**:
1. AOF 활성화 확인:
```bash
redis-cli CONFIG GET appendonly
# 1 이어야 함
```

2. 설정 파일 확인:
```bash
sudo grep "appendonly" /etc/redis/redis.conf
# appendonly yes
```

3. AOF 파일 확인:
```bash
ls -lh /var/lib/redis/appendonly.aof
```

## 📈 성능 최적화

### 1. 메모리 최적화

```conf
# /etc/redis/redis.conf

# LRU 정책 (가장 오래 사용되지 않은 키 삭제)
maxmemory-policy allkeys-lru

# 샘플링 크기 (기본값: 5)
maxmemory-samples 10
```

### 2. 지속성 최적화

```conf
# AOF fsync 정책
appendfsync everysec  # 1초마다 디스크에 쓰기 (권장)
# appendfsync always  # 매번 쓰기 (느림, 안전)
# appendfsync no      # OS에 맡김 (빠름, 위험)

# AOF 재작성
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
```

### 3. 네트워크 최적화

```conf
# TCP Keepalive
tcp-keepalive 300

# 클라이언트 연결 시간 초과
timeout 300

# 최대 클라이언트 연결 수
maxclients 10000
```

### 4. 키 설계 최적화

```typescript
// ✅ 좋은 예: 네임스페이스와 TTL 사용
await redis.setex('navigation:session:abc123', 600, data);
await redis.setex('tts:phrase:hash123', 86400 * 30, data);

// ❌ 나쁜 예: 네임스페이스 없음, TTL 없음
await redis.set('abc123', data);
```

## 🔐 보안 권장사항

### 1. 비밀번호 설정

```bash
# 강력한 비밀번호 생성
openssl rand -base64 32

# redis.conf에 설정
requirepass <generated-password>
```

### 2. 명령어 제한

```conf
# 위험한 명령어 비활성화
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command KEYS ""
rename-command CONFIG ""
```

### 3. 네트워크 격리

- VPC 내부 통신만 허용
- 외부 접속 필요 시 VPN 사용
- 보안 그룹으로 접근 제한

## 📚 참고 자료

- [Redis 공식 문서](https://redis.io/documentation)
- [Redis 명령어 레퍼런스](https://redis.io/commands)
- [ioredis 문서](https://github.com/redis/ioredis)
- [@liaoliaots/nestjs-redis](https://github.com/liaoliaots/nestjs-redis)

## 🔍 모니터링 대시보드

### Redis Commander (Web UI)

```bash
# Docker로 설치
docker run -d \
  --name redis-commander \
  -p 8081:8081 \
  -e REDIS_HOSTS=local:redis:6379:0:password \
  rediscommander/redis-commander

# 접속: http://localhost:8081
```

### RedisInsight (공식 GUI)

```bash
# Docker로 설치
docker run -d \
  --name redisinsight \
  -p 8001:8001 \
  redislabs/redisinsight:latest

# 접속: http://localhost:8001
```
