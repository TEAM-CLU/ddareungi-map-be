# 네비게이션 Return 로직 아키텍처

## 📋 **개요**

사용자가 경로에서 이탈했을 때, **원래 경로로 복귀하는 로직**입니다.

- ✅ **Geometry 정보** (실제 경로 좌표) 포함하여 반환
- ✅ **Redis에 통합된 경로 저장** (세션 일관성 유지)
- ✅ **책임과 권한 명확히 분리**

---

## 🏗️ **아키텍처 설계**

### **책임 분리**

```
NavigationReturnService (비즈니스 로직)
  ├─ 복귀 지점 찾기
  ├─ GraphHopper로 복귀 경로 생성
  ├─ 남은 원래 경로 추출
  └─ Redis 저장 및 응답 생성

NavigationHelperService (유틸리티)
  ├─ GraphHopper 응답 → RouteSegmentDto 변환
  ├─ Segment 병합 (geometry + instructions)
  ├─ Instructions interval 조정
  └─ 거리 계산 및 좌표 처리

Redis (데이터 저장소)
  ├─ navigation:session:{sessionId}
  └─ route:{routeId}
```

---

## 🔄 **Return 프로세스 (10단계)**

### **1️⃣ 세션 조회**

```typescript
const sessionData = JSON.parse(sessionJson) as {
  routeId: string;
  route: NavigationRouteRedis;
};
```

- Redis에서 `navigation:session:{sessionId}` 조회
- 원래 경로 데이터 로드

---

### **2️⃣ 가장 가까운 경로 지점 찾기**

```typescript
const closestPoint = helperService.findClosestPointOnRoute(
  currentLocation,
  originalRoute,
);

// 반환값:
{
  segmentIndex: 1,
  pointIndex: 20,
  coordinate: { lat: 37.5665, lng: 126.978 },
  distance: 150  // 미터
}
```

- Haversine 공식으로 모든 segments의 모든 points 순회
- 현재 위치에서 가장 가까운 지점 탐색

---

### **3️⃣ 다음 Instruction 지점 찾기**

```typescript
const nextInstruction = helperService.findNextInstructionPoint(
  originalRoute,
  closestPoint.segmentIndex,
  closestPoint.pointIndex,
);

// 반환값:
{
  coordinate: { lat: 37.5547, lng: 126.9707 },
  segmentType: 'biking',
  segmentIndex: 1,
  instructionIndex: 4
}
```

- 현재 segment의 남은 instructions 확인
- `instruction.interval[0] > pointIndex`인 첫 instruction
- 없으면 다음 segment의 첫 instruction

---

### **4️⃣ 복귀 경로 생성**

```typescript
// Profile 자동 선택
const profile =
  nextInstruction.segmentType === 'biking'
    ? originalRoute.segments[nextInstruction.segmentIndex].profile ||
      'safe_bike'
    : 'foot';

// GraphHopper API 호출
const ghPath = await graphHopperService.getSingleRoute(
  currentLocation,
  nextInstruction.coordinate,
  profile,
);
```

- **Biking**: 원래 segment의 profile 사용 (`safe_bike` / `fast_bike`)
- **Walking**: `foot` profile 사용

---

### **5️⃣ GraphHopper 응답 변환**

```typescript
const returnSegment = helperService.convertGraphHopperPathToSegment(
  ghPath,
  nextInstruction.segmentType === 'biking' ? 'biking' : 'walking',
  profile as 'safe_bike' | 'fast_bike',
);

// returnSegment 구조:
{
  type: 'biking',
  summary: { distance: 450, time: 120, ascent: 5, descent: 3 },
  bbox: { minLat: ..., maxLat: ... },
  geometry: { points: [[lng, lat], ...] },
  profile: BikeProfile.SAFE_BIKE,
  instructions: [
    { distance: 100, time: 30, text: '직진', sign: 0, interval: [0, 5] },
    ...
  ]
}
```

- **Geometry 포함**: 실제 경로 좌표 배열
- **Instructions**: 턴바이턴 안내
- **시간 변환**: ms → s

---

### **6️⃣ 남은 원래 경로 추출**

```typescript
// 다음 instruction부터 끝까지
for (
  let i = nextInstruction.segmentIndex;
  i < originalRoute.segments.length;
  i++
) {
  if (i === nextInstruction.segmentIndex) {
    // 부분 포함: nextInstruction 이후만
    const remainingInstructions = segment.instructions.slice(
      nextInstruction.instructionIndex,
    );

    // Geometry도 instruction의 interval에 맞춰 자르기
    const startPointIndex = remainingInstructions[0].interval[0];
    const remainingPoints = segment.geometry.points.slice(startPointIndex);

    // Interval 재조정 (startPointIndex만큼 빼기)
    const adjustedInstructions = remainingInstructions.map((inst) => ({
      ...inst,
      interval: [
        inst.interval[0] - startPointIndex,
        inst.interval[1] - startPointIndex,
      ] as [number, number],
    }));

    // Summary도 비율에 맞춰 조정
    const remainingRatio =
      remainingPoints.length / segment.geometry.points.length;

    remainingSegments.push({
      type: segment.type,
      summary: {
        distance: segment.summary.distance * remainingRatio,
        time: segment.summary.time * remainingRatio,
        ascent: segment.summary.ascent * remainingRatio,
        descent: segment.summary.descent * remainingRatio,
      },
      bbox: segment.bbox,
      geometry: { points: remainingPoints },
      profile: segment.profile,
      instructions: adjustedInstructions,
    });
  } else {
    // 전체 포함
    remainingSegments.push(segment);
  }
}
```

- **Geometry 절단**: instruction의 interval에 맞춰 정확히 자르기
- **Interval 재조정**: 0부터 다시 시작하도록 조정
- **Summary 비율 조정**: 남은 거리/시간 재계산

---

### **7️⃣ Segment 병합**

```typescript
const mergedSegments = helperService.mergeSegments(
  [returnSegment],
  remainingSegments,
);
```

#### **병합 규칙**

```typescript
// 인접한 같은 타입의 세그먼트 통합
if (lastSegment.type === firstSegment.type) {
  return {
    type: 'biking',
    summary: {
      distance: seg1.distance + seg2.distance,  // 합산
      time: seg1.time + seg2.time,
      ...
    },
    geometry: {
      points: [
        ...seg1.geometry.points,
        ...seg2.geometry.points.slice(1),  // 첫 점은 중복 제거
      ],
    },
    instructions: mergeInstructions(
      seg1.instructions,
      seg2.instructions,
      seg1.geometry.points.length - 1,  // Offset
    ),
  };
}
```

#### **Instruction Interval 조정**

```typescript
// seg2의 instructions를 seg1의 geometry 길이만큼 offset
instructions2.map((inst) => ({
  ...inst,
  interval: [inst.interval[0] + offset, inst.interval[1] + offset] as [
    number,
    number,
  ],
}));
```

---

### **8️⃣ Instructions 통합**

```typescript
const allInstructions: InstructionDto[] = mergedSegments.flatMap(
  (seg) => seg.instructions || [],
);
```

- 모든 segments의 instructions를 평탄화
- 프론트엔드 호환성 유지

---

### **9️⃣ Redis 저장**

```typescript
const updatedRoute: NavigationRouteRedis = {
  ...originalRoute,
  segments: mergedSegments, // ✅ 통합된 경로로 업데이트
};

const updatedSessionData = {
  routeId: sessionData.routeId,
  route: updatedRoute,
};

await Promise.all([
  redis.setex(
    `navigation:session:${sessionId}`,
    NAVIGATION_SESSION_TTL,
    JSON.stringify(updatedSessionData),
  ),
  redis.setex(
    `route:${sessionData.routeId}`,
    NAVIGATION_SESSION_TTL,
    JSON.stringify(updatedRoute),
  ),
]);
```

- **원래 경로 대체**: 복귀 경로 + 남은 경로로 완전히 교체
- **세션 일관성**: 다음 이탈 시에도 동일한 로직 적용 가능
- **TTL 갱신**: 600초 (10분)

---

### **🔟 응답 반환**

```typescript
return {
  sessionId,
  segments: mergedSegments, // ✅ Geometry 포함
  instructions: allInstructions, // ✅ Instructions 포함
};
```

---

## 📊 **데이터 흐름**

```
사용자 이탈
   │
   ├─ 1. Redis 조회 (원래 경로)
   │
   ├─ 2. 가장 가까운 지점 찾기 (Haversine)
   │
   ├─ 3. 다음 Instruction 찾기
   │
   ├─ 4. GraphHopper 복귀 경로 생성
   │      └─ Profile 자동 선택 (safe_bike/fast_bike/foot)
   │
   ├─ 5. GraphHopper 응답 → RouteSegmentDto 변환
   │      └─ geometry, instructions, summary 포함
   │
   ├─ 6. 남은 원래 경로 추출
   │      └─ geometry 절단, interval 재조정, summary 비율 조정
   │
   ├─ 7. Segment 병합
   │      └─ 같은 타입이면 통합, interval offset 조정
   │
   ├─ 8. Instructions 평탄화
   │
   ├─ 9. Redis 저장 (통합된 경로로 업데이트)
   │      ├─ navigation:session:{sessionId}
   │      └─ route:{routeId}
   │
   └─ 10. 프론트엔드 응답
         ├─ segments (geometry 포함)
         └─ instructions (호환성)
```

---

## 🎯 **핵심 설계 원칙**

### **1. 원래 경로 보존 ❌ → 통합 경로로 업데이트 ✅**

```typescript
// 변경 전: 원래 경로는 보존, instructions만 반환
await redis.expire(sessionKey, NAVIGATION_SESSION_TTL); // TTL만 갱신

// 변경 후: 통합된 경로로 완전히 업데이트
const updatedRoute = { ...originalRoute, segments: mergedSegments };
await redis.setex(
  sessionKey,
  NAVIGATION_SESSION_TTL,
  JSON.stringify(updatedRoute),
);
```

### **2. Geometry 포함**

- **변경 전**: Instructions만 반환 → 프론트엔드가 경로 그릴 수 없음
- **변경 후**: `segments` 배열에 `geometry.points` 포함 → 지도에 경로 렌더링 가능

### **3. Segment 병합 최적화**

- 인접한 같은 타입의 segments 자동 통합
- Geometry points 중복 제거
- Instruction interval 자동 조정

### **4. 모든 경로 타입 지원**

- **Direct**: A → B
- **Multi-leg**: A → 경유지1 → 경유지2 → B
- **Roundtrip**: A → 경유지들 → A
- **Circular**: A → 턴포인트들 → A

---

## 🧪 **예시 시나리오**

### **시나리오: Multi-leg 경로에서 이탈**

#### **원래 경로**

```typescript
{
  routeType: 'multi-leg',
  segments: [
    { type: 'walking', distance: 300, points: 15개 },    // 출발지 → 대여소A
    { type: 'biking', distance: 5000, points: 250개 },   // 대여소A → 대여소B
    { type: 'walking', distance: 200, points: 10개 },    // 대여소B → 경유지1
    { type: 'walking', distance: 200, points: 10개 },    // 경유지1 → 대여소B
    { type: 'biking', distance: 3000, points: 150개 },   // 대여소B → 대여소C
    { type: 'walking', distance: 400, points: 20개 },    // 대여소C → 목적지
  ]
}
```

#### **이탈 상황**

- 현재 위치: segment[1] (대여소A → 대여소B) 구간의 중간
- 가장 가까운 지점: segment[1], point[100] (40% 지점)

#### **복귀 경로 생성**

```typescript
// 1. 다음 instruction: segment[1], instruction[5]
// 2. GraphHopper: 현재 위치 → instruction[5] 좌표
// 3. 복귀 segment:
{
  type: 'biking',
  distance: 800,
  points: 40개,
  instructions: 5개
}
```

#### **남은 경로 추출**

```typescript
// segment[1]의 남은 부분:
{
  type: 'biking',
  distance: 3000,  // 원래의 60%
  points: 150개,   // point[100]부터 끝까지
  instructions: 10개  // instruction[5]부터 끝까지
}

// segment[2~5] 전체 포함
```

#### **병합 결과**

```typescript
// 복귀 segment + 남은 segment[1] → 통합 (같은 타입)
{
  type: 'biking',
  distance: 800 + 3000 = 3800,
  points: 40 + 150 = 190개,
  instructions: 5 + 10 = 15개
}

// 최종 segments:
[
  { type: 'biking', distance: 3800, points: 190개 },    // 통합됨
  { type: 'walking', distance: 200, points: 10개 },     // segment[2]
  { type: 'walking', distance: 200, points: 10개 },     // segment[3]
  { type: 'biking', distance: 3000, points: 150개 },    // segment[4]
  { type: 'walking', distance: 400, points: 20개 },     // segment[5]
]
```

#### **Redis 저장**

```typescript
navigation:session:{sessionId} = {
  routeId: 'abc123',
  route: {
    routeType: 'multi-leg',
    segments: [ ...통합된 5개 segments... ]
  }
}
```

#### **프론트엔드 응답**

```typescript
{
  sessionId: 'uuid-...',
  segments: [ ...통합된 5개 segments (geometry 포함)... ],
  instructions: [ ...평탄화된 50개 instructions... ]
}
```

---

## ✅ **기존 로직과의 차이점**

| 항목              | 기존 로직         | 개선된 로직                             |
| ----------------- | ----------------- | --------------------------------------- |
| **반환 데이터**   | Instructions만    | Segments (geometry 포함) + Instructions |
| **Redis 저장**    | 원래 경로 보존    | 통합된 경로로 업데이트                  |
| **Geometry 정보** | ❌ 없음           | ✅ 포함                                 |
| **프론트엔드**    | 경로 그릴 수 없음 | 경로 렌더링 가능                        |
| **세션 일관성**   | TTL만 갱신        | 전체 경로 업데이트                      |
| **책임 분리**     | 단일 서비스       | Helper 서비스로 유틸리티 분리           |

---

## 🚀 **성능 최적화**

### **1. Segment 병합**

- 같은 타입의 인접 segments 자동 통합
- Geometry points 중복 제거 (`slice(1)`)
- Instructions interval 효율적 재계산

### **2. Redis 최적화**

- `setex`로 저장 + TTL 설정 (한 번의 명령)
- `Promise.all`로 병렬 저장 (session + route)

### **3. 메모리 효율**

- Instruction interval 재조정으로 정확한 인덱스 유지
- Summary 비율 조정으로 정확한 거리/시간 계산

---

## 📝 **코드 위치**

```
src/navigation/
├── services/
│   ├── navigation-return.service.ts      # 복귀 로직 (비즈니스)
│   └── navigation-helper.service.ts      # 유틸리티 함수
├── dto/
│   ├── navigation.dto.ts                 # ReturnToRouteResponseDto
│   └── navigation-route-redis.interface.ts  # NavigationRouteRedis
└── navigation.controller.ts              # API 엔드포인트
```

---

## 🎯 **결론**

✅ **Geometry 정보 포함**으로 프론트엔드가 경로 렌더링 가능  
✅ **Redis 저장**으로 세션 일관성 유지  
✅ **책임 분리**로 유지보수성 향상  
✅ **모든 경로 타입 지원** (direct, multi-leg, roundtrip, circular)  
✅ **Segment 병합 최적화**로 불필요한 데이터 제거

이제 사용자가 경로에서 이탈해도 **geometry 정보를 포함한 통합 경로**를 받아 지도에 정확하게 표시할 수 있습니다! 🎉
