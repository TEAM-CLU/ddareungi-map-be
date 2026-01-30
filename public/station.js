(function () {
  // 지도/카카오 참조 및 대여소 마커 상태
  let kakaoRef, mapRef;
  let stationMarker;
  let stationMarkers = [];
  let stationIntervalId = null;

  // 대여소 기능 초기 설정
  const initStationSeting = (kakao, map) => {
    kakaoRef = kakao;
    mapRef = map;
    ensureNoTapHighlightCSS();
  };

  // 부드러운 이동 후 필요 시 확대/축소
  const smoothPanAndZoom = (position, level) => {
    mapRef.panTo(position);
    if (typeof level === 'number') {
      setTimeout(() => {
        mapRef.setLevel(level, { animate: true, anchor: position });
      }, 250);
    }
  };

  // 모바일 브라우저에서 탭 하이라이트, 텍스트 선택, 포커스 아웃라인 제거
  const ensureNoTapHighlightCSS = () => {
    if (document.getElementById('no-tap-style')) return;
    const s = document.createElement('style');
    s.id = 'no-tap-style';
    s.textContent = `
    .station-marker, .station-marker * {
      -webkit-tap-highlight-color: rgba(0,0,0,0);
      -webkit-touch-callout: none;
      user-select: none;
      -webkit-user-select: none;
      outline: none;
    }
    .station-marker:active { background: transparent !important; }
    .station-marker svg text {
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
    }
  `;
    document.head.appendChild(s);
  };

  // 대여소 마커 SVG 생성 함수
  const getStationMarkerSvg = (label = '', color = '#01DA86') => `
<svg xmlns="http://www.w3.org/2000/svg" width="41" height="48" viewBox="0 0 41 48" fill="none">
  <g filter="url(#filter0_d)">
    <path fill-rule="evenodd" clip-rule="evenodd"
      d="M36 16.5C36 28.5556 20.5 38.8889 20.5 38.8889C20.5 38.8889 5 28.5556 5 16.5C5 7.93959 11.9396 1 20.5 1C29.0604 1 36 7.93959 36 16.5Z"
      fill="white" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <text
      x="20.5"
      y="14"
      text-anchor="middle"
      alignment-baseline="central"
      dy=".35em"
      fill="#414548"
      font-family="Pretendard, 'Noto Sans KR', Arial, sans-serif"
      font-size="15"
      font-weight="600"
      line-height="24"
    >
      ${label}
    </text>
  </g>
  <defs>
    <filter id="filter0_d" x="0" y="0" width="41" height="47.8889"
      filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feFlood flood-opacity="0" result="BackgroundImageFix"/>
      <feColorMatrix in="SourceAlpha" type="matrix"
        values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
      <feOffset dy="4"/>
      <feGaussianBlur stdDeviation="2"/>
      <feComposite in2="hardAlpha" operator="out"/>
      <feColorMatrix type="matrix"
        values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>
      <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow"/>
      <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape"/>
    </filter>
  </defs>
</svg>
`;

  // 문자열 SVG를 감싼 실제 DOM 엘리먼트를 만들어 반환
  const buildStationContentElement = (label, color, stationNumber) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = getStationMarkerSvg(label, color);
    wrap.className = 'station-marker';
    wrap.style.cursor = 'pointer';
    wrap.style.transform = 'translateZ(0)';
    wrap.dataset.stationNumber = String(stationNumber);
    return wrap;
  };

  // 특정 스테이션 번호의 오버레이 컨텐츠에 클릭 바인딩
  const bindOverlayClick = stationNumber => {
    const targetedStationMarker = stationMarkers.find(
      s => s.number === stationNumber,
    );
    if (!targetedStationMarker) return;

    const content = targetedStationMarker.marker.getContent?.();
    // getContent가 Node거나 문자열일 수 있으니, Node로 보장되도록 했음(buildStationContentEl 사용)
    const targetedStationElement = typeof content === 'string' ? null : content;
    if (!targetedStationElement) return;

    // 중복 바인딩 방지
    targetedStationElement.onclick = null;

    targetedStationElement.onclick = () => {
      const position = targetedStationMarker.marker.getPosition();
      // 지도 중심 이동 / 줌 레벨 조정
      const currentLevel = mapRef.getLevel();
      if (currentLevel > 3) {
        smoothPanAndZoom(position, 3);
      } else {
        mapRef.panTo(position);
      }

      // React Native로 정보 전달
      const targetedStationMetaData = targetedStationMarker.metaData || null;
      window.ReactNativeWebView?.postMessage(
        JSON.stringify({
          type: 'clickStationMarker',
          stationData: targetedStationMetaData,
        }),
      );
    };
  };

  // 모든 대여소 마커 정리
  const clearStationMarkers = () => {
    if (stationMarkers.length > 0) {
      stationMarkers.forEach(stationData => stationData.marker.setMap(null));
      stationMarkers = [];
    }
  };

  // 대여소 목록을 지도 마커로 렌더링하고 주기 갱신을 시작
  const createStationMarkers = stationsDataList => {
    // 기존 대여소 마커 및 메타데이터 제거
    clearStationMarkers();

    // 새 stationsDataList 기반으로 마커 생성
    stationsDataList.forEach(station => {
      const stationPos = new kakaoRef.maps.LatLng(
        station.latitude,
        station.longitude,
      );

      const contentElement = buildStationContentElement(
        station.current_bikes,
        '#01DA86',
        station.number,
      );

      stationMarker = new kakaoRef.maps.CustomOverlay({
        position: stationPos,
        content: contentElement,
        yAnchor: 1,
        zIndex: 11,
        clickable: true,
      });

      stationMarker.setMap(mapRef);

      stationMarkers.push({
        number: station.number,
        marker: stationMarker,
        metaData: station,
      });

      // 클릭이벤트 바인딩
      bindOverlayClick(station.number);
    });

    // 최신 재고 정보 업데이트 요청
    const targetedStationsNumberList =
      stationsDataList.map(station => station.number) ?? [];
    if (targetedStationsNumberList.length === 0) return;

    // 최초 1회 바로 실행
    window.ReactNativeWebView?.postMessage(
      JSON.stringify({
        type: 'needUpdateStationBikeCountList',
        stationNumbers: targetedStationsNumberList,
      }),
    );

    // 주기 갱신 (5초)
    if (stationIntervalId) clearInterval(stationIntervalId);
    stationIntervalId = setInterval(() => {
      window.ReactNativeWebView?.postMessage(
        JSON.stringify({
          type: 'needUpdateStationBikeCountList',
          stationNumbers: targetedStationsNumberList,
        }),
      );
    }, 5000);
  };

  // 주기 갱신으로 받은 재고 정보를 기존 마커에 반영
  const updateStationBikeCountList = stationBikeCountList => {
    if (
      !stationBikeCountList ||
      stationBikeCountList.length === 0 ||
      stationMarkers.length === 0
    )
      return;

    stationMarkers.forEach(({ number, marker, metaData }) => {
      const targetedStation = stationBikeCountList.find(
        i => i.station_number === number,
      );
      if (!targetedStation) return;
      // 메타데이터 최신화
      metaData.current_bikes = targetedStation.current_bikes;

      // 컨텐츠 교체 (DOM으로 다시 생성)
      const newElement = buildStationContentElement(
        targetedStation.current_bikes,
        '#01DA86',
        number,
      );
      marker.setContent(newElement);

      // 클릭 이벤트 재바인딩 (setContent 후 필수)
      bindOverlayClick(number);
    });
  };

  // 마커 보이기/숨기기 토글
  const toggleStationMarkers = isVisible => {
    if (stationMarkers.length === 0) return;
    stationMarkers.forEach(({ marker }) => {
      if (isVisible) {
        marker.setMap(mapRef);
      } else {
        marker.setMap(null);
      }
    });
  };

  // nearby 모달 클릭시 포커싱
  const focusOnTargetedNearbyStation = targetedStationData => {
    const targetedStationPos = new kakaoRef.maps.LatLng(
      targetedStationData.latitude,
      targetedStationData.longitude,
    );

    // 맵 센터 이동 / 줌 레벨 조정
    const currentLevel = mapRef.getLevel();
    if (currentLevel > 3) {
      smoothPanAndZoom(targetedStationPos, 3);
    } else {
      mapRef.panTo(targetedStationPos);
    }
  };

  // 인터벌과 마커를 정리해 리소스를 해제
  const destroyStation = () => {
    if (stationIntervalId) {
      clearInterval(stationIntervalId);
      stationIntervalId = null;
    }
    clearStationMarkers();
  };

  window.Station = {
    initStationSeting,
    createStationMarkers,
    updateStationBikeCountList,
    toggleStationMarkers,
    destroyStation,
    focusOnTargetedNearbyStation,
  };

  window.addEventListener('pagehide', () => {
    destroyStation();
  });
})();
