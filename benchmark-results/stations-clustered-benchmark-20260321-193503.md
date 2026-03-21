# Clustered Station Benchmark

scenarioType: clustered
clusterSeed: 20260316

# Benchmark Summary

## 지도 조회 비교

### map_legacy

| 반경 | 평균(ms) | 최소 | 최대 | p50 | p95 | 외부 API/요청 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000m end-to-end | 1085.82 | 1050.11 | 1121.53 | 1050.11 | 1121.53 | 7.00 |
| hotspot usage | - | - | - | - | - | hotspot usage: gongneung_center=0, nowon_station=0, seoultech=0, seoul_womens_univ=2, sahmyook_univ=0 |
| 5000m end-to-end | 48980.76 | 45019.11 | 52942.41 | 45019.11 | 52942.41 | 266.00 |
| hotspot usage | - | - | - | - | - | hotspot usage: gongneung_center=0, nowon_station=0, seoultech=0, seoul_womens_univ=2, sahmyook_univ=0 |

### map_split_no_lock

| 반경 | 평균(ms) | 최소 | 최대 | p50 | p95 | 외부 API/요청 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000m end-to-end | 196.12 | 130.18 | 262.06 | 130.18 | 262.06 | 7.00 |
| 1000m map-only | 20.12 | 16.69 | 23.55 | 16.69 | 23.55 | 7.00 |
| hotspot usage | - | - | - | - | - | hotspot usage: gongneung_center=0, nowon_station=0, seoultech=0, seoul_womens_univ=2, sahmyook_univ=0 |
| 5000m end-to-end | 2954.48 | 2828.49 | 3080.48 | 2828.49 | 3080.48 | 266.00 |
| 5000m map-only | 58.23 | 33.80 | 82.66 | 33.80 | 82.66 | 266.00 |
| hotspot usage | - | - | - | - | - | hotspot usage: gongneung_center=0, nowon_station=0, seoultech=0, seoul_womens_univ=2, sahmyook_univ=0 |

### map_split_with_lock

| 반경 | 평균(ms) | 최소 | 최대 | p50 | p95 | 외부 API/요청 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000m end-to-end | 183.39 | 128.79 | 237.99 | 128.79 | 237.99 | 7.00 |
| 1000m map-only | 16.60 | 15.96 | 17.24 | 15.96 | 17.24 | 7.00 |
| hotspot usage | - | - | - | - | - | hotspot usage: gongneung_center=0, nowon_station=0, seoultech=0, seoul_womens_univ=2, sahmyook_univ=0 |
| 5000m end-to-end | 3084.90 | 2973.71 | 3196.09 | 2973.71 | 3196.09 | 266.00 |
| 5000m map-only | 40.97 | 39.62 | 42.33 | 39.62 | 42.33 | 266.00 |
| hotspot usage | - | - | - | - | - | hotspot usage: gongneung_center=0, nowon_station=0, seoultech=0, seoul_womens_univ=2, sahmyook_univ=0 |

## Redis 락 비교

### 1000m

| 모드 | sync 요청 | 락 획득 | 락 스킵 | end-to-end avg(ms) | p95(ms) | 외부 API 호출 | 감소율 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| without_lock | 88 | 0 | 0 | 500.12 | 535.99 | 88 | 0.00% |
| with_lock | 87 | 48 | 39 | 368.27 | 470.63 | 48 | 45.45% |
hotspot usage: gongneung_center=2, nowon_station=1, seoultech=1, seoul_womens_univ=0, sahmyook_univ=0

### 5000m

| 모드 | sync 요청 | 락 획득 | 락 스킵 | end-to-end avg(ms) | p95(ms) | 외부 API 호출 | 감소율 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| without_lock | 955 | 0 | 0 | 2868.06 | 3934.15 | 955 | 0.00% |
| with_lock | 954 | 725 | 229 | 2329.82 | 3890.15 | 725 | 24.08% |
hotspot usage: gongneung_center=1, nowon_station=0, seoultech=0, seoul_womens_univ=1, sahmyook_univ=2

