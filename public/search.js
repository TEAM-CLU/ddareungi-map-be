(function () {
  // 지도/카카오 참조 및 검색 마커 상태
  let kakaoRef, mapRef;
  let currentPlaceMarker;

  // 검색 기능 초기 설정
  const initSearchSetting = (kakao, map) => {
    kakaoRef = kakao;
    mapRef = map;
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

  // 장소 마커 표시 - 검색 결과에서 장소 선택 시
  const showPlaceMarker = (lat, lng, placeName, placeInfo) => {
    // 기존 마커 제거
    clearCurrentPlaceMarker();

    const position = new kakaoRef.maps.LatLng(lat, lng);

    // 임시 커스텀 마커 SVG -> 추후 변경
    const markerSvg = `
      <div style="
        position: relative;
        width: 32px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <svg xmlns='http://www.w3.org/2000/svg' width='32' height='40' viewBox='0 0 32 40' fill='none'>
          <path d='M16 0C24.8 0 32 7.2 32 16C32 28 16 40 16 40S0 28 0 16C0 7.2 7.2 0 16 0Z' fill='#FF6B35'/>
          <circle cx='16' cy='16' r='8' fill='white'/>
          <circle cx='16' cy='16' r='4' fill='#FF6B35'/>
        </svg>
      </div>
    `;

    currentPlaceMarker = new kakaoRef.maps.CustomOverlay({
      position: position,
      content: markerSvg,
      xAnchor: 0.5,
      yAnchor: 1,
      zIndex: 100,
    });

    currentPlaceMarker.setMap(mapRef);

    // 맵 중심을 해당 위치로 이동
    smoothPanAndZoom(position, 3);
  };

  // 현재 장소 마커 제거
  const clearCurrentPlaceMarker = () => {
    if (currentPlaceMarker) {
      currentPlaceMarker.setMap(null);
      currentPlaceMarker = null;
    }
  };

  window.Search = {
    initSearchSetting,
    showPlaceMarker,
    clearCurrentPlaceMarker,
  };
})();
