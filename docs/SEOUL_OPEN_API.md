# Seoul Open API 연동 가이드

서울시 공공데이터 API를 통해 따릉이 대여소 정보와 실시간 자전거 현황을 조회합니다.

## 📋 개요

- **제공 기관**: 서울특별시
- **API 유형**: REST API (XML 응답)
- **사용 목적**: 대여소 위치, 자전거 현황, 거치대 정보 조회
- **업데이트 주기**: 실시간 (5-10분 간격)
- **사용 모듈**: `src/stations/` 모듈

## 🔑 API 키 발급

### 1. 서울 열린데이터 광장 가입

1. [서울 열린데이터 광장](https://data.seoul.go.kr) 접속
2. 회원가입 (간단한 정보 입력)
3. 로그인

### 2. API 신청

1. 상단 메뉴 > **오픈API** 클릭
2. 검색창에 **"따릉이"** 검색
3. **서울특별시 공공자전거 실시간 대여정보** 선택
4. **활용신청** 버튼 클릭
5. 신청 사유 작성 (예: "자전거 경로 안내 앱 개발")
6. 즉시 승인 → API 인증키 발급

### 3. API 키 확인

- **마이페이지** > **인증키 관리**에서 확인
- 형식: 40자리 16진수 문자열

## ⚙️ 환경 설정

### 환경 설정 (`.env`)

```env
# Seoul Open API 키 (서울 열린데이터 광장에서 발급)
SEOUL_OPEN_API_KEY=your_seoul_api_key_here
```

> ⚠️ **보안 주의**: API 키는 Git에 커밋하지 마세요. `.env` 파일은 `.gitignore`에 포함되어 있습니다.
> 📝 **참고**: [서울 열린데이터 광장](https://data.seoul.go.kr)에서 무료로 발급받을 수 있습니다.

## 📡 API 엔드포인트

### 1. 대여소 정보 조회

**엔드포인트**:
```
http://openapi.seoul.go.kr:8088/{API_KEY}/xml/tbCycleStationInfo/{START_INDEX}/{END_INDEX}/
```

**파라미터**:
- `START_INDEX`: 시작 인덱스 (1부터 시작)
- `END_INDEX`: 종료 인덱스 (최대 1000개)

**응답 예시** (XML):
```xml
<SeoulPublicBikeRentalSvcStationInfo>
  <list_total_count>2614</list_total_count>
  <RESULT>
    <CODE>INFO-000</CODE>
    <MESSAGE>정상 처리되었습니다</MESSAGE>
  </RESULT>
  <row>
    <STATION_NUMBER>ST-4</STATION_NUMBER>
    <STATION_NAME>102. 망원역 1번출구 앞</STATION_NAME>
    <RENTING_NUMBER>12</RENTING_NUMBER>
    <LATITUDE>37.5556488</LATITUDE>
    <LONGITUDE>126.9101802</LONGITUDE>
  </row>
  <!-- 더 많은 row ... -->
</SeoulPublicBikeRentalSvcStationInfo>
```

### 2. 실시간 대여 정보 조회

**엔드포인트**:
```
http://openapi.seoul.go.kr:8088/{API_KEY}/xml/bikeList/{START_INDEX}/{END_INDEX}/
```

**응답 예시** (XML):
```xml
<rentBikeStatus>
  <list_total_count>2614</list_total_count>
  <RESULT>
    <CODE>INFO-000</CODE>
    <MESSAGE>정상 처리되었습니다</MESSAGE>
  </RESULT>
  <row>
    <stationName>102. 망원역 1번출구 앞</stationName>
    <rackTotCnt>22</rackTotCnt>
    <parkingBikeTotCnt>12</parkingBikeTotCnt>
    <shared>15</shared>
    <stationLatitude>37.5556488</stationLatitude>
    <stationLongitude>126.9101802</stationLongitude>
    <stationId>ST-4</stationId>
  </row>
  <!-- 더 많은 row ... -->
</rentBikeStatus>
```

## 💻 코드 구현

### SeoulApiService

**위치**: `src/stations/services/seoul-api.service.ts`

**주요 메서드**:

```typescript
@Injectable()
export class SeoulApiService {
  // 대여소 정보 조회
  async fetchStationInfo(startIndex: number, endIndex: number): Promise<any> {
    const url = `http://openapi.seoul.go.kr:8088/${this.apiKey}/xml/tbCycleStationInfo/${startIndex}/${endIndex}/`;
    const response = await axios.get(url);
    return this.parseXmlResponse(response.data);
  }

  // 실시간 자전거 현황 조회
  async fetchRealtimeStatus(startIndex: number, endIndex: number): Promise<any> {
    const url = `http://openapi.seoul.go.kr:8088/${this.apiKey}/xml/bikeList/${startIndex}/${endIndex}/`;
    const response = await axios.get(url);
    return this.parseXmlResponse(response.data);
  }

  // XML 파싱
  private async parseXmlResponse(xmlData: string): Promise<any> {
    const parser = new xml2js.Parser({ explicitArray: false });
    return await parser.parseStringPromise(xmlData);
  }
}
```

### 스케줄링 (주간 동기화)

**위치**: `src/stations/services/station-sync.service.ts`

```typescript
@Injectable()
export class StationSyncService {
  // 매주 일요일 새벽 2시에 실행
  @Cron('0 2 * * 0')
  async syncStations() {
    this.logger.log('대여소 정보 동기화 시작');
    
    const totalCount = 2614; // 서울시 전체 대여소 수
    const batchSize = 1000;
    
    for (let start = 1; start <= totalCount; start += batchSize) {
      const end = Math.min(start + batchSize - 1, totalCount);
      const data = await this.seoulApiService.fetchStationInfo(start, end);
      
      // 데이터베이스 저장
      await this.saveStations(data);
    }
    
    this.logger.log('대여소 정보 동기화 완료');
  }
}
```

## 🧪 테스트

### 로컬에서 API 테스트

```bash
# 대여소 정보 조회 (첫 10개)
curl "http://openapi.seoul.go.kr:8088/YOUR_API_KEY/xml/tbCycleStationInfo/1/10/"

# 실시간 현황 조회 (첫 10개)
curl "http://openapi.seoul.go.kr:8088/YOUR_API_KEY/xml/bikeList/1/10/"
```

### Postman 테스트

1. GET 요청 생성
2. URL: `http://openapi.seoul.go.kr:8088/{YOUR_API_KEY}/xml/bikeList/1/10/`
3. Send 클릭
4. 응답 확인 (XML 형식)

### 애플리케이션 테스트

```bash
# 로컬 서버 실행
pnpm run start:local

# 대여소 목록 조회 API 호출
curl http://localhost:3000/stations

# 특정 좌표 근처 대여소 조회
curl "http://localhost:3000/stations/nearby?lat=37.5665&lng=126.978&radius=1000"
```

## 📊 데이터 흐름

```
Seoul Open API
      │
      ▼
SeoulApiService (XML 파싱)
      │
      ▼
StationSyncService (주간 동기화)
      │
      ▼
PostgreSQL (Station Entity)
      │
      ▼
StationQueryService (PostGIS 쿼리)
      │
      ▼
API Response (JSON)
```

## ⚠️ 제한 사항 및 주의사항

### API 호출 제한
- **일일 호출 제한**: 1,000회/일 (무료 계정)
- **분당 호출 제한**: 60회/분
- **동시 요청**: 최대 5개

### 에러 코드

| 코드 | 설명 | 해결 방법 |
|------|------|-----------|
| `INFO-000` | 정상 처리 | - |
| `ERROR-300` | 필수 값 누락 | API 키 확인 |
| `ERROR-310` | 해당하는 데이터 없음 | 인덱스 범위 확인 |
| `ERROR-500` | 서버 오류 | 잠시 후 재시도 |
| `ERROR-600` | 인증키 오류 | API 키 재확인 |

### 베스트 프랙티스

1. **배치 처리**: 1000개씩 나눠서 조회
2. **캐싱**: 대여소 정보는 주 1회만 동기화
3. **에러 핸들링**: 재시도 로직 구현
4. **로깅**: 동기화 결과 기록

## 🔧 트러블슈팅

### 1. API 키 인증 실패 (ERROR-600)

**증상**:
```
ERROR-600: 인증키가 유효하지 않습니다
```

**해결**:
1. `.env` 파일의 `SEOUL_OPEN_API_KEY` 확인
2. 서울 열린데이터 광장 > 마이페이지에서 API 키 재확인
3. 키 복사 시 공백이나 특수문자 포함 여부 확인

### 2. 호출 제한 초과 (429 Too Many Requests)

**증상**:
```
HTTP 429: Too Many Requests
```

**해결**:
1. 호출 간격 조정 (최소 1초 이상)
2. 배치 크기 줄이기 (1000 → 500)
3. 스케줄링 빈도 조정 (일 1회 → 주 1회)

### 3. XML 파싱 오류

**증상**:
```
Error: Non-whitespace before first tag
```

**해결**:
1. API 응답 확인 (HTML 에러 페이지 반환 여부)
2. API 엔드포인트 URL 확인
3. xml2js 파서 옵션 조정

### 4. 데이터 동기화 실패

**증상**:
- 로그: "대여소 정보 동기화 실패"
- 데이터베이스에 데이터 없음

**해결**:
1. PM2 로그 확인: `pm2 logs ddareungimap-api`
2. 데이터베이스 연결 확인
3. `@Cron` 스케줄러 활성화 확인 (`app.module.ts`)

## 📈 모니터링

### 동기화 로그 확인

```bash
# PM2 로그 필터링
pm2 logs ddareungimap-api | grep "동기화"

# 최근 100줄 로그
pm2 logs ddareungimap-api --lines 100
```

### 데이터베이스 확인

```sql
-- 대여소 수 확인
SELECT COUNT(*) FROM station;

-- 최근 동기화 시간 확인
SELECT MAX(created_at) FROM sync_log WHERE sync_type = 'station';

-- 대여소 정보 샘플 확인
SELECT number, name, lat, lng FROM station LIMIT 10;
```

## 🚀 성능 최적화

### 1. 배치 처리 최적화

```typescript
// 1000개씩 병렬 처리
const batches = [
  [1, 1000],
  [1001, 2000],
  [2001, 2614]
];

await Promise.all(
  batches.map(([start, end]) => 
    this.seoulApiService.fetchStationInfo(start, end)
  )
);
```

### 2. 데이터베이스 인덱싱

```sql
-- 위치 기반 검색 최적화 (PostGIS)
CREATE INDEX idx_station_location ON station USING GIST(location);

-- 대여소 번호 검색 최적화
CREATE INDEX idx_station_number ON station(number);
```

### 3. 캐싱 전략

- **대여소 정보**: 주 1회 동기화 (데이터베이스)
- **실시간 현황**: API 호출 시마다 조회 (캐싱 없음)

## 📚 참고 자료

- [서울 열린데이터 광장](https://data.seoul.go.kr)
- [따릉이 공식 홈페이지](https://www.bikeseoul.com)
- [서울시 공공자전거 API 문서](https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do)
