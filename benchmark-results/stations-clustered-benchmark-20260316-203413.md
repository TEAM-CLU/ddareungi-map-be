# Clustered Station Benchmark

scenarioType: clustered
clusterSeed: 20260316

# Benchmark Summary

## 지도 조회 비교

### map_legacy

| 반경 | 평균(ms) | 최소 | 최대 | p50 | p95 | 외부 API/요청 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000m end-to-end | 1037.79 | 934.05 | 1141.53 | 934.05 | 1141.53 | 7.00 |
| hotspot usage | - | - | - | - | - | hotspot usage: gongneung_center=0, nowon_station=0, seoultech=0, seoul_womens_univ=2, sahmyook_univ=0 |
| 5000m end-to-end | 40462.83 | 40055.83 | 40869.84 | 40055.83 | 40869.84 | 269.00 |
| hotspot usage | - | - | - | - | - | hotspot usage: gongneung_center=0, nowon_station=0, seoultech=0, seoul_womens_univ=2, sahmyook_univ=0 |

### map_split_no_lock

| 반경 | 평균(ms) | 최소 | 최대 | p50 | p95 | 외부 API/요청 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000m end-to-end | 1903.32 | 1502.95 | 2303.70 | 1502.95 | 2303.70 | 7.00 |
| 1000m map-only | 36.64 | 16.01 | 57.27 | 16.01 | 57.27 | 7.00 |
| hotspot usage | - | - | - | - | - | hotspot usage: gongneung_center=0, nowon_station=0, seoultech=0, seoul_womens_univ=2, sahmyook_univ=0 |
| 5000m end-to-end | 44361.14 | 41295.10 | 47427.18 | 41295.10 | 47427.18 | 269.00 |
| 5000m map-only | 51.74 | 43.12 | 60.36 | 43.12 | 60.36 | 269.00 |
| hotspot usage | - | - | - | - | - | hotspot usage: gongneung_center=0, nowon_station=0, seoultech=0, seoul_womens_univ=2, sahmyook_univ=0 |

### map_split_with_lock

| 반경 | 평균(ms) | 최소 | 최대 | p50 | p95 | 외부 API/요청 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000m end-to-end | 1053.06 | 980.58 | 1125.54 | 980.58 | 1125.54 | 7.00 |
| 1000m map-only | 17.65 | 14.92 | 20.38 | 14.92 | 20.38 | 7.00 |
| hotspot usage | - | - | - | - | - | hotspot usage: gongneung_center=0, nowon_station=0, seoultech=0, seoul_womens_univ=2, sahmyook_univ=0 |
| 5000m end-to-end | 42751.75 | 39509.22 | 45994.27 | 39509.22 | 45994.27 | 269.00 |
| 5000m map-only | 115.14 | 42.85 | 187.44 | 42.85 | 187.44 | 269.00 |
| hotspot usage | - | - | - | - | - | hotspot usage: gongneung_center=0, nowon_station=0, seoultech=0, seoul_womens_univ=2, sahmyook_univ=0 |

## Redis 락 비교

### 1000m

| 모드 | sync 요청 | 락 획득 | 락 스킵 | end-to-end avg(ms) | p95(ms) | 외부 API 호출 | 감소율 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| without_lock | 91 | 0 | 0 | 3341.64 | 3851.74 | 91 | 0.00% |
| with_lock | 91 | 75 | 16 | 2875.47 | 3847.19 | 75 | 17.58% |
hotspot usage: gongneung_center=2, nowon_station=1, seoultech=1, seoul_womens_univ=0, sahmyook_univ=0

### 5000m

| 모드 | sync 요청 | 락 획득 | 락 스킵 | end-to-end avg(ms) | p95(ms) | 외부 API 호출 | 감소율 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| without_lock | 971 | 0 | 0 | 36838.94 | 51347.87 | 971 | 0.00% |
| with_lock | 971 | 899 | 72 | 34915.05 | 51940.52 | 899 | 7.42% |
hotspot usage: gongneung_center=1, nowon_station=0, seoultech=0, seoul_womens_univ=1, sahmyook_univ=2

