## 📌 개요

- 사용자가 출발지와 목적지 입력 시, '도보-자전거-도보' 3단계 통합 경로를 한 번에 제공하여 '파편화된 이동 경험' 문제를 해결합니다.

## 🗒️ 작업 내용

- `/route/integrated` API 엔드포인트 구현
- 출발지/목적지 기준 최근접 따릉이 대여소 탐색 로직 추가
- GraphHopper를 3회 호출(도보1, 자전거, 도보2)하여 3개 경로를 조합하는 서비스 로직 구현
- **변경된 파일:**
  - `src/route/route.controller.ts`
  - `src/route/route.service.ts`
  - `src/route/dto/integrated-route.dto.ts`

## 💬 리뷰 요구사항

- 3개로 나뉜 경로(도보1, 자전거, 도보2)가 매끄럽게 하나의 응답(총 시간, 총 거리, 통합 좌표)으로 잘 조합되는지 확인 부탁드립니다.
- GraphHopper 호출 시 각 구간별(도보/자전거) 가중치(profile)가 올바르게 적용되었는지 확인해주세요.

## 🔗 관련 이슈

- Closes #15
