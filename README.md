<div align="center">
  <img src="https://github.com/user-attachments/assets/b41b9529-d411-41db-a649-54c989320348" width="300" alt="따릉이맵 로고" />

<h1>🚲 따릉이맵 (Ddareungi Map)</h1>

  <p>
    서울 공공자전거 따릉이 이용 시 발생하는 경로 탐색 불편 문제를 해결하기 위해 개발한 서비스입니다.

기존 따릉이 앱은 대여소 위치만 제공하고 대여소까지 이동 경로와 자전거 이동 경로를 함께 안내하지 않습니다.

따릉이맵은 이를 해결하기 위해

**도보 → 자전거 → 도보**

이동을 하나의 경로로 제공하는 **통합 경로 탐색 서비스**입니다.<br/>

  </p>
</div>

<br/>

### 📱 Preview

|                                                      대여소 지도                                                      |                                                       경로 안내                                                       |                                                      네비게이션                                                       |                                                      마이페이지                                                       |
| :-------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------: |
| <img width="250" alt="image" src="https://github.com/user-attachments/assets/3365f08b-4d84-4fc2-8f90-8f74ffc7721b" /> | <img width="250" alt="image" src="https://github.com/user-attachments/assets/3c8b80ef-b89a-473a-bf84-c12fb129ba16" /> | <img width="250" alt="image" src="https://github.com/user-attachments/assets/03009264-0e76-4cef-88ba-0413274892f0" /> | <img width="250" alt="image" src="https://github.com/user-attachments/assets/3290fe53-3652-456e-8ce5-2cb6acb701e1" /> |

<br/>

## ✨ 주요 기능

| 기능                 | 설명                                                       |
| :------------------- | :--------------------------------------------------------- |
| **🗺️ 대여소 지도**   | 현재 위치 기반 따릉이 대여소 조회, 잔여 자전거 실시간 확인 |
| **📍 경로 안내**     | 도보와 자전거가 결합된 최적 경로 검색 및 음성 안내         |
| **🔍 검색 자동완성** | Kakao Local API 기반의 빠르고 정확한 장소/주소 검색        |
| **👤 마이페이지**    | 라이딩 기록 확인 및 앱 설정 관리                           |

<br/>

## 🛠 기술 스택

| 분류                 | 기술                                                     |
| :------------------- | :------------------------------------------------------- |
| **Core**             | NestJS, TypeScript                                       |
| **Routing Engine**   | GraphHopper                                              |
| **Database**         | Supabase (PostgreSQL)                                    |
| **Cache**            | Redis                                                    |
| **Infrastructure**   | AWS EC2, AWS Route53                                     |
| **Storage**          | AWS S3                                                   |
| **Containerization** | Docker                                                   |
| **Authentication**   | OAuth PKCE, JWT                                          |
| **External APIs**    | Kakao Local API, Seoul Public Bike API, Google Cloud TTS |

<br/>

## 📂 프로젝트 구조

```
src/
├── 📁 auth/         # 인증 및 소셜 로그인
├── 📁 common/       # 공통 응답, 로깅, 인터셉터
├── 📁 location/     # 장소 검색 및 위치 조회
├── 📁 mail/         # 이메일 발송
├── 📁 navigation/   # 실시간 네비게이션
├── 📁 routes/       # 경로 탐색 및 최적화
├── 📁 stations/     # 따릉이 대여소 데이터 관리
├── 📁 tts/          # 음성 안내 생성
└── 📁 user/         # 사용자 및 통계 관리
```
