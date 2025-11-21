# GraphHopper 서버 설정 가이드

자전거 경로 계산 및 최적화를 위한 GraphHopper 서버 설치 및 설정 가이드입니다.

## 📋 개요

- **제공**: GraphHopper (오픈소스)
- **용도**: 자전거 경로 계산, 경로 최적화, 턴바이턴 네비게이션
- **라이선스**: Apache License 2.0
- **사용 모듈**: `src/routes/` 모듈

## 🏗️ 아키텍처

```
Backend API (NestJS)
      │
      ▼
GraphHopperService
      │
      ▼
HTTP Request (POST /route)
      │
      ▼
GraphHopper Server (Java)
      │
      ▼
OSM Map Data (Seoul)
      │
      ▼
Route Response (JSON)
```

## 📦 설치 방법

### 방법 1: Docker로 설치 (권장)

#### 1. Docker 이미지 받기

```bash
docker pull graphhopper/graphhopper:latest
```

#### 2. OSM 지도 데이터 다운로드

OSM 데이터:
```bash
# 대한민국 전체
wget https://download.geofabrik.de/asia/south-korea-latest.osm.pbf
```

#### 3. Docker 실행

```bash
docker run -d \
  --name graphhopper \
  -p 8989:8989 \
  -v $(pwd)/south-korea-latest.osm.pbf:/data/south-korea-latest.osm.pbf \
  -v $(pwd)/graphhopper-cache:/data/graph-cache \
  graphhopper/graphhopper:latest \
  --input /data/south-korea-latest.osm.pbf \
  --host 0.0.0.0 \
  --port 8989
```

**옵션 설명**:
- `-p 8989:8989`: 포트 매핑
- `-v`: 볼륨 마운트 (데이터 및 캐시)
- `--host 0.0.0.0`: 외부 접속 허용
- `--port 8989`: 서버 포트

### 방법 2: 직접 설치

#### 1. Java 설치 (JDK 17 이상)

```bash
# Ubuntu/EC2
sudo apt update
sudo apt install openjdk-17-jdk -y

# macOS
brew install openjdk@17
```

#### 2. GraphHopper 다운로드

```bash
wget https://github.com/graphhopper/graphhopper/releases/download/8.0/graphhopper-web-8.0.jar
```

#### 3. OSM 데이터 다운로드

```bash
wget https://download.geofabrik.de/asia/south-korea-latest.osm.pbf
```

#### 4. 서버 실행

```bash
java -Xmx3g -Xms3g \
  -jar graphhopper-web-8.0.jar \
  server \
  config-example.yml
```

**메모리 설정**:
- `-Xmx3g`: 최대 힙 메모리 3GB
- `-Xms3g`: 초기 힙 메모리 3GB
- 서울시만: 2GB, 전국: 4GB 이상 권장

## ⚙️ 설정 파일 (config.yml)

### 기본 설정

```yaml
# config.yml
graphhopper:
  datareader.file: south-korea-latest.osm.pbf
  graph.location: graph-cache
  
  # 자전거 프로파일 설정
  profiles:
    - name: bike
      vehicle: bike
      weighting: fastest
      turn_costs: true
      
    - name: safe_bike
      vehicle: bike
      weighting: short_fastest
      turn_costs: true
      # 자전거 도로 우선
      custom_model:
        priority:
          - if: road_class == CYCLEWAY
            multiply_by: 2.0
          - if: road_class == PRIMARY || road_class == TRUNK
            multiply_by: 0.5
    
    - name: fast_bike
      vehicle: bike
      weighting: fastest
      turn_costs: false

  # 서버 설정
  server:
    application_connectors:
      - type: http
        port: 8989
        bind_host: 0.0.0.0
    
    # CORS 설정
    cors:
      allowed_origins: "*"
      allowed_methods: "GET,POST,PUT,DELETE,OPTIONS"
      allowed_headers: "*"

  # 그래프 빌드 설정
  graph.flag_encoders: bike
  graph.encoded_values: road_class,road_environment,max_speed,road_access
  prepare.min_network_size: 200
  prepare.min_one_way_network_size: 200
```

## 🔧 환경 설정

### 환경 설정 (`.env`)

```env
# GraphHopper 서버 URL
GRAPHHOPPER_URL=http://your-server-ip:8989

# 로컬 개발 시
# GRAPHHOPPER_URL=http://localhost:8989
```

> 📝 **구성**: GraphHopper 서버를 EC2 또는 로컬에서 실행하고 해당 URL을 설정하세요.
> 🔒 **보안**: EC2 보안 그룹에서 8989 포트를 필요한 IP에만 허용하세요.

## 💻 코드 구현

### GraphHopperService

**위치**: `src/routes/services/graphhopper.service.ts`

```typescript
@Injectable()
export class GraphHopperService {
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('GRAPHHOPPER_URL');
  }

  /**
   * 경로 계산 요청
   */
  async calculateRoute(
    points: [number, number][],
    profile: BikeProfile = BikeProfile.SAFE_BIKE,
  ): Promise<GraphHopperResponse> {
    const url = `${this.baseUrl}/route`;
    
    const response = await axios.post(url, {
      points: points.map(([lat, lng]) => [lng, lat]), // [lng, lat] 순서
      profile: profile,
      locale: 'ko',
      instructions: true,
      points_encoded: false,
      elevation: true,
    });

    return response.data;
  }

  /**
   * 다중 경로 요청 (여러 프로파일)
   */
  async calculateMultipleRoutes(
    points: [number, number][],
    profiles: BikeProfile[],
  ): Promise<GraphHopperResponse[]> {
    const requests = profiles.map(profile => 
      this.calculateRoute(points, profile)
    );
    
    return await Promise.all(requests);
  }
}
```

### API 요청 예시

```typescript
// 단일 경로 (안전한 자전거 도로 우선)
const route = await this.graphHopperService.calculateRoute(
  [
    [37.5665, 126.9780], // 서울역
    [37.5172, 127.0473], // 강남역
  ],
  BikeProfile.SAFE_BIKE
);

// 다중 경로 (안전/빠름 비교)
const routes = await this.graphHopperService.calculateMultipleRoutes(
  [
    [37.5665, 126.9780],
    [37.5172, 127.0473],
  ],
  [BikeProfile.SAFE_BIKE, BikeProfile.FAST_BIKE]
);
```

## 🧪 테스트

### cURL로 직접 테스트

```bash
curl -X POST "http://localhost:8989/route" \
  -H "Content-Type: application/json" \
  -d '{
    "points": [
      [126.9780, 37.5665],
      [127.0473, 37.5172]
    ],
    "profile": "bike",
    "locale": "ko",
    "instructions": true,
    "points_encoded": false
  }'
```

### Postman 테스트

1. POST 요청 생성
2. URL: `http://localhost:8989/route`
3. Headers: `Content-Type: application/json`
4. Body (raw JSON):
```json
{
  "points": [
    [126.9780, 37.5665],
    [127.0473, 37.5172]
  ],
  "profile": "bike",
  "locale": "ko",
  "instructions": true
}
```

### 애플리케이션 테스트

```bash
# 로컬 서버 실행
pnpm run start:local

# 경로 계산 API 호출
curl -X POST "http://localhost:3000/routes/point-to-point" \
  -H "Content-Type: application/json" \
  -d '{
    "start": {"lat": 37.5665, "lng": 126.9780},
    "end": {"lat": 37.5172, "lng": 127.0473},
    "profile": "safe_bike"
  }'
```

## 📊 응답 형식

### GraphHopper 응답 예시

```json
{
  "paths": [
    {
      "distance": 15432.5,
      "time": 3245000,
      "ascend": 123.4,
      "descend": 98.7,
      "points": {
        "coordinates": [
          [126.9780, 37.5665],
          [126.9785, 37.5670],
          [127.0473, 37.5172]
        ]
      },
      "instructions": [
        {
          "distance": 150.2,
          "time": 30000,
          "text": "100m 직진 후 좌회전",
          "sign": 2,
          "interval": [0, 5]
        }
      ],
      "snapped_waypoints": {
        "coordinates": [
          [126.9780, 37.5665],
          [127.0473, 37.5172]
        ]
      }
    }
  ],
  "info": {
    "copyrights": ["GraphHopper", "OpenStreetMap contributors"],
    "took": 234
  }
}
```

## 🔧 EC2 배포

### 1. EC2 인스턴스 요구사항

- **인스턴스 타입**: t3.medium 이상 (메모리 4GB+)
- **스토리지**: 20GB 이상 (OSM 데이터 + 캐시)
- **보안 그룹**: 8989 포트 인바운드 허용

### 2. 설치 스크립트

```bash
#!/bin/bash

# Java 설치
sudo apt update
sudo apt install openjdk-17-jdk -y

# GraphHopper 디렉토리 생성
mkdir -p ~/graphhopper
cd ~/graphhopper

# GraphHopper 다운로드
wget https://github.com/graphhopper/graphhopper/releases/download/8.0/graphhopper-web-8.0.jar

# OSM 데이터 다운로드
wget https://download.geofabrik.de/asia/south-korea-latest.osm.pbf

# 설정 파일 생성
cat > config.yml << 'EOF'
graphhopper:
  datareader.file: south-korea-latest.osm.pbf
  graph.location: graph-cache
  
  profiles:
    - name: bike
      vehicle: bike
      weighting: fastest
    - name: safe_bike
      vehicle: bike
      weighting: short_fastest
    - name: fast_bike
      vehicle: bike
      weighting: fastest
  
  server:
    application_connectors:
      - type: http
        port: 8989
        bind_host: 0.0.0.0
EOF

# systemd 서비스 파일 생성
sudo tee /etc/systemd/system/graphhopper.service > /dev/null << 'EOF'
[Unit]
Description=GraphHopper Routing Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/graphhopper
ExecStart=/usr/bin/java -Xmx3g -Xms3g -jar graphhopper-web-8.0.jar server config.yml
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 서비스 시작
sudo systemctl daemon-reload
sudo systemctl enable graphhopper
sudo systemctl start graphhopper

# 상태 확인
sudo systemctl status graphhopper
```

### 3. 서비스 관리

```bash
# 시작
sudo systemctl start graphhopper

# 중지
sudo systemctl stop graphhopper

# 재시작
sudo systemctl restart graphhopper

# 상태 확인
sudo systemctl status graphhopper

# 로그 확인
sudo journalctl -u graphhopper -f
```

## ⚠️ 트러블슈팅

### 1. 메모리 부족 (OutOfMemoryError)

**증상**:
```
java.lang.OutOfMemoryError: Java heap space
```

**해결**:
1. 힙 메모리 증가: `-Xmx4g -Xms4g`
2. EC2 인스턴스 업그레이드 (t3.medium → t3.large)
3. OSM 데이터 범위 축소 (전국 → 서울만)

### 2. 경로 계산 실패 (No route found)

**증상**:
```json
{
  "message": "Cannot find point 0: 37.5665,126.9780",
  "hints": []
}
```

**해결**:
1. 좌표 순서 확인 ([lng, lat] 순서)
2. 좌표가 OSM 데이터 범위 내에 있는지 확인
3. 도로 네트워크 연결 확인

### 3. 서버 연결 실패 (Connection refused)

**증상**:
```
Error: connect ECONNREFUSED 43.200.11.89:8989
```

**해결**:
1. GraphHopper 서버 실행 상태 확인
2. 방화벽/보안 그룹 8989 포트 허용 확인
3. `config.yml`의 `bind_host: 0.0.0.0` 설정 확인

### 4. 느린 경로 계산

**증상**:
- 첫 요청 5-10초 소요
- 이후 요청도 2-3초 소요

**해결**:
1. 그래프 캐시 프리로드 (첫 시작 시 자동)
2. `prepare.ch.weightings` 설정으로 Contraction Hierarchies 사용
3. EC2 인스턴스 CPU 업그레이드

## 📈 성능 최적화

### 1. Contraction Hierarchies (CH) 활성화

```yaml
# config.yml
graphhopper:
  prepare:
    ch.weightings: fastest
    ch.threads: 4
```

**효과**: 경로 계산 속도 10-100배 향상

### 2. 그래프 캐시 재사용

```bash
# 그래프 캐시 디렉토리 보존
-v $(pwd)/graphhopper-cache:/data/graph-cache
```

**효과**: 재시작 시 그래프 재빌드 불필요 (30분 → 10초)

### 3. 메모리 튜닝

```bash
# 서울시만 (2GB)
java -Xmx2g -Xms2g -jar graphhopper-web-8.0.jar

# 전국 (4GB)
java -Xmx4g -Xms4g -jar graphhopper-web-8.0.jar
```

## 📚 참고 자료

- [GraphHopper 공식 문서](https://docs.graphhopper.com/)
- [GraphHopper GitHub](https://github.com/graphhopper/graphhopper)
- [Geofabrik OSM 다운로드](https://download.geofabrik.de/)
- [OpenStreetMap Wiki](https://wiki.openstreetmap.org/)

## 🔍 모니터링

### 헬스 체크

```bash
# 서버 상태 확인
curl http://localhost:8989/health

# 응답 예시
{
  "status": "ready"
}
```

### 성능 메트릭

```bash
# 경로 계산 시간 측정
time curl -X POST "http://localhost:8989/route" -d '...'
```

### 로그 확인

```bash
# systemd 로그
sudo journalctl -u graphhopper -f --since "10 minutes ago"

# Docker 로그
docker logs -f graphhopper
```
