(function () {
  // 지도/카카오 참조 및 네비게이션 마커 상태
  let kakaoRef, mapRef;
  let startMarker,
    endMarker,
    originMarker,
    waypointsMarkers = [],
    startStationMarker,
    endStationMarker;

  // 네비게이션 자전거 경로 폴리라인 상태
  let navigationBikeRouteOutlineList = []; // 외곽선 라인 리스트
  let navigationBikeRouteMainList = []; // 기본 컬러 라인 리스트
  let navigationBikeRouteGrayList = []; // 회색 처리 라인 리스트
  let navigationBikeRouteHighlightLine = null;
  let selectedBikeSegmentIndex = -1;
  let navigationBikeRouteArrowList = [];
  let handleMapZoomChanged = null;

  // 도보 구간 점선 폴리라인 상태
  let navigationWalkingToStartDot; // 출발지 -> 출발 대여소
  let navigationWalkingToEndDot; // 도착 대여소 -> 도착지
  let navigationWalkingToOriginDot; // 원점 -> 대여소 -> 원점

  // 경로 바운드 계산에 사용할 전체 좌표
  let kakaoPathForFocusOnBound = [];

  // interval 업데이트에서 재사용할 자전거 경로 캐시
  let cachedFullBikeKakaoPath = [];
  let cachedIntervals = [];
  let cachedBikeStartIdx = 0;

  // 네비게이션 오버레이/폴리라인 초기 설정
  const initNavigationSetting = (kakao, map, DEFAULT_LAT, DEFAULT_LNG) => {
    kakaoRef = kakao;
    mapRef = map;

    const defaultPos = new kakaoRef.maps.LatLng(DEFAULT_LAT, DEFAULT_LNG);

    // 출발/도착/원점 마커 SVG 생성 함수
    const buildMarkerHTML = (
      label,
      fill = '#006AFF',
      textColor = '#fff',
      stroke = null,
    ) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40" style="display:block">
    <path d="M32.001 16.8882C32.001 29.333 16.0005 40 16.0005 40C16.0005 40 0 29.333 0 16.8882C0 8.05136 7.16366 0.8877 16.0005 0.8877C24.8373 0.8877 32.001 8.05136 32.001 16.8882Z"
      fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="2"` : ''}/>
    <text x="16" y="16" text-anchor="middle"
      alignment-baseline="central" dy=".35em"
      font-family="Pretendard, 'Noto Sans KR', Arial, sans-serif"
      font-size="12" font-weight="bold"
      fill="${textColor}">
      ${label}
    </text>
  </svg>
`;

    const startMarkerSvg = buildMarkerHTML('출발', '#006AFF', '#fff');
    const endMarkerSvg = buildMarkerHTML('도착', '#FF0000', '#fff');
    const originMarkerSvg = buildMarkerHTML('원점', '#000000', '#FFFFFF');

    startMarker = new kakaoRef.maps.CustomOverlay({
      position: defaultPos,
      content: startMarkerSvg,
      yAnchor: 1,
      zIndex: 10,
    });

    endMarker = new kakaoRef.maps.CustomOverlay({
      position: defaultPos,
      content: endMarkerSvg,
      yAnchor: 1,
      zIndex: 10,
    });

    originMarker = new kakaoRef.maps.CustomOverlay({
      position: defaultPos,
      content: originMarkerSvg,
      yAnchor: 1,
      zIndex: 12,
    });

    startStationMarker = new kakaoRef.maps.CustomOverlay({
      position: defaultPos,
      content: getStationMarkerSvg('대여소'),
      yAnchor: 1,
      zIndex: 9,
    });

    endStationMarker = new kakaoRef.maps.CustomOverlay({
      position: defaultPos,
      content: getStationMarkerSvg('대여소'),
      yAnchor: 1,
      zIndex: 9,
    });

    // 도보 경로들 (점선)
    navigationWalkingToStartDot = new kakaoRef.maps.Polyline({
      path: [],
      strokeColor: '#006AFF',
      strokeWeight: 5,
      strokeOpacity: 1,
      strokeStyle: 'shortdot',
      zIndex: 6,
    });

    navigationWalkingToEndDot = new kakaoRef.maps.Polyline({
      path: [],
      strokeColor: '#FF0000',
      strokeWeight: 5,
      strokeOpacity: 1,
      strokeStyle: 'shortdot',
      zIndex: 6,
    });

    navigationWalkingToOriginDot = new kakaoRef.maps.Polyline({
      path: [],
      strokeColor: '#000000',
      strokeWeight: 5,
      strokeOpacity: 1,
      strokeStyle: 'shortdot',
      zIndex: 6,
    });
  };

  // 대여소 마커 svg 생성 함수
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
      font-size="10"
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

  // 경유지 마커 svg 생성 함수
  const getWaypointMarkerSvg = (label = '') => `
  <svg xmlns="http://www.w3.org/2000/svg"
       width="32" height="40" viewBox="0 0 32 44"
       style="display:block">
    <path d="M32.001 17.8882C32.001 30.333 16.0005 41 16.0005 41C16.0005 41 0 30.333 0 17.8882C0 9.05136 7.16366 1.8877 16.0005 1.8877C24.8373 1.8877 32.001 9.05136 32.001 17.8882Z"
          fill="#FAE100" stroke="#FFFFFF" stroke-width="2"/>
    <text x="16" y="16" text-anchor="middle"
      alignment-baseline="central" dy=".35em"
      font-family="Pretendard, 'Noto Sans KR', Arial, sans-serif"
      font-size="10" font-weight="bold"
      fill="#111">
      ${label}
    </text>
  </svg>
`;

  const clearWaypointsMarkers = () => {
    if (waypointsMarkers.length > 0) {
      waypointsMarkers.forEach(wayPointMarker => wayPointMarker.setMap(null));
      waypointsMarkers = [];
    }
  };

  const createWaypointsMarkers = waypoints => {
    clearWaypointsMarkers();
    waypoints.forEach((waypoint, idx) => {
      const waypointPos = new kakaoRef.maps.LatLng(waypoint.lat, waypoint.lng);
      const waypointMarker = new kakaoRef.maps.CustomOverlay({
        position: waypointPos,
        content: getWaypointMarkerSvg(`경유${idx + 1}`),
        yAnchor: 1,
        zIndex: 11,
      });
      waypointMarker.setMap(mapRef);
      waypointsMarkers.push(waypointMarker);
    });
  };

  // 단순 좌표 배열 -> kakao.maps.LatLng 배열 변환 함수
  const convertToKakaoLatLngArray = coords => {
    return coords.map(coord => {
      const [lng, lat] = coord;
      return new kakaoRef.maps.LatLng(lat, lng);
    });
  };

  // 대여소와 가장 가까운 좌표 추출
  const findNearestIndexOnPath = (coords, targetLat, targetLng) => {
    if (!Array.isArray(coords) || coords.length === 0) return -1;

    let bestIdx = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    coords.forEach(([lng, lat], idx) => {
      const dLng = lng - targetLng;
      const dLat = lat - targetLat;
      const score = Math.abs(dLng) + Math.abs(dLat);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });

    return bestIdx;
  };

  const findExactIndexOnPath = (coords, targetLat, targetLng) => {
    return coords.findIndex(
      ([lng, lat]) => lat === targetLat && lng === targetLng,
    );
  };

  // 색상 채널 값을 0~255 범위로 제한
  const clampColorChannel = value => Math.max(0, Math.min(255, value));

  // HEX 색상을 밝게 조정
  const lightenHexColor = (hex, amount = 40) => {
    const raw = hex.replace('#', '');
    if (raw.length !== 6) return hex;
    const r = clampColorChannel(parseInt(raw.slice(0, 2), 16) + amount);
    const g = clampColorChannel(parseInt(raw.slice(2, 4), 16) + amount);
    const b = clampColorChannel(parseInt(raw.slice(4, 6), 16) + amount);
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  };

  // HEX 색상을 어둡게 조정
  const darkenHexColor = (hex, amount = 40) => {
    const raw = hex.replace('#', '');
    if (raw.length !== 6) return hex;
    const r = clampColorChannel(parseInt(raw.slice(0, 2), 16) - amount);
    const g = clampColorChannel(parseInt(raw.slice(2, 4), 16) - amount);
    const b = clampColorChannel(parseInt(raw.slice(4, 6), 16) - amount);
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  };

  // 자전거 경로 화살표 렌더링 관련 상수
  const BIKE_ROUTE_ARROW_SPACING_M = 60;
  const BIKE_ROUTE_ARROW_VISIBLE_MAX_LEVEL = 5;

  // 진행 방향을 표시하는 작은 화살표 SVG
  const getBikeRouteArrowSvg = (rotationDeg, color) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 12 12"
    style="display:block; transform: rotate(${rotationDeg}deg); transform-origin: 50% 50%;">
    <polygon points="6,1 10,11 2,11" fill="${color}" stroke="#FFFFFF" stroke-width="1"/>
  </svg>
`;

  // 각도/거리 계산 유틸
  const toRad = deg => (deg * Math.PI) / 180;
  const toDeg = rad => (rad * 180) / Math.PI;

  // 두 좌표 사이의 구면 거리(미터)
  const getDistanceMeters = (lat1, lng1, lat2, lng2) => {
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6378137 * c;
  };

  // 도보 경로 샘플링 간격(미터)
  const WALKING_SAMPLE_DISTANCE_M = 15;

  // 일정 거리 간격으로 경로를 샘플링해 점선 밀도를 조절
  const samplePathByDistance = (coords, minDistanceM) => {
    if (!Array.isArray(coords) || coords.length < 2) return coords;
    const sampled = [coords[0]];
    let last = coords[0];
    let acc = 0;

    for (let i = 1; i < coords.length; i++) {
      const [lng2, lat2] = coords[i];
      const [lng1, lat1] = last;
      const dist = getDistanceMeters(lat1, lng1, lat2, lng2);
      acc += dist;
      if (acc >= minDistanceM) {
        sampled.push(coords[i]);
        last = coords[i];
        acc = 0;
      }
    }

    if (sampled[sampled.length - 1] !== coords[coords.length - 1]) {
      sampled.push(coords[coords.length - 1]);
    }

    return sampled;
  };

  // 두 좌표 사이의 방위각(0~360도)
  const getBearingDeg = (lat1, lng1, lat2, lng2) => {
    const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.cos(toRad(lng2 - lng1));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  };

  // 자전거 경로 화살표 및 줌 리스너 정리
  const clearBikeRouteArrows = () => {
    if (navigationBikeRouteArrowList.length > 0) {
      navigationBikeRouteArrowList.forEach(overlay => overlay.setMap(null));
      navigationBikeRouteArrowList = [];
    }
    if (mapRef && handleMapZoomChanged) {
      kakaoRef.maps.event.removeListener(
        mapRef,
        'zoom_changed',
        handleMapZoomChanged,
      );
      handleMapZoomChanged = null;
    }
  };

  // 화살표 오버레이를 지도 표시 여부에 따라 토글
  const setBikeRouteArrowVisibility = visible => {
    navigationBikeRouteArrowList.forEach(overlay =>
      overlay.setMap(visible ? mapRef : null),
    );
  };

  // 줌 레벨에 따라 화살표 표시 여부 결정
  const updateArrowVisibilityByZoom = () => {
    if (!mapRef) return;
    const level = mapRef.getLevel();
    setBikeRouteArrowVisibility(level <= BIKE_ROUTE_ARROW_VISIBLE_MAX_LEVEL);
  };

  // 일정 간격으로 자전거 경로에 화살표 오버레이 생성
  const createBikeRouteArrows = (coords, color, useAlternate, zIndex) => {
    if (!Array.isArray(coords) || coords.length < 2) return;
    let distFromLast = 0;
    let arrowIndex = 0;

    for (let i = 0; i < coords.length - 1; i++) {
      let [lng1, lat1] = coords[i];
      let [lng2, lat2] = coords[i + 1];
      let segLen = getDistanceMeters(lat1, lng1, lat2, lng2);
      if (segLen <= 0) continue;

      while (distFromLast + segLen >= BIKE_ROUTE_ARROW_SPACING_M) {
        const remain = BIKE_ROUTE_ARROW_SPACING_M - distFromLast;
        const t = remain / segLen;
        const lat = lat1 + (lat2 - lat1) * t;
        const lng = lng1 + (lng2 - lng1) * t;
        let bearing = getBearingDeg(lat1, lng1, lat2, lng2);
        if (useAlternate && arrowIndex % 2 === 1) {
          bearing = (bearing + 180) % 360;
        }
        const arrowPos = new kakaoRef.maps.LatLng(lat, lng);
        const arrowOverlay = new kakaoRef.maps.CustomOverlay({
          position: arrowPos,
          content: getBikeRouteArrowSvg(bearing, lightenHexColor(color, 30)),
          xAnchor: 0.5,
          yAnchor: 0.5,
          zIndex,
        });
        arrowOverlay.setMap(mapRef);
        navigationBikeRouteArrowList.push(arrowOverlay);

        arrowIndex += 1;
        lat1 = lat;
        lng1 = lng;
        segLen -= remain;
        distFromLast = 0;
      }

      distFromLast += segLen;
    }
    updateArrowVisibilityByZoom();
    if (mapRef) {
      if (handleMapZoomChanged) {
        kakaoRef.maps.event.removeListener(
          mapRef,
          'zoom_changed',
          handleMapZoomChanged,
        );
      }
      handleMapZoomChanged = () => updateArrowVisibilityByZoom();
      kakaoRef.maps.event.addListener(
        mapRef,
        'zoom_changed',
        handleMapZoomChanged,
      );
    }
  };

  // 선택 해제 시 기존 세그먼트 zIndex 복구
  const resetBikeRouteSegmentZIndex = idx => {
    if (idx < 0) return;
    const baseZIndex = 5 + idx;
    const mainLine = navigationBikeRouteMainList[idx];
    const outlineLine = navigationBikeRouteOutlineList[idx];
    if (mainLine) {
      mainLine.setOptions({ zIndex: baseZIndex });
    }
    if (outlineLine) {
      outlineLine.setOptions({ zIndex: baseZIndex });
    }
  };

  // 선택 강조선 제거 및 상태 초기화
  const clearBikeRouteSelection = (shouldUpdateArrow = true) => {
    if (navigationBikeRouteHighlightLine) {
      navigationBikeRouteHighlightLine.setMap(null);
      navigationBikeRouteHighlightLine = null;
    }
    resetBikeRouteSegmentZIndex(selectedBikeSegmentIndex);
    selectedBikeSegmentIndex = -1;
    if (shouldUpdateArrow) {
      updateArrowVisibilityByZoom();
    }
  };

  // 선택한 자전거 구간을 강조 표시
  const setBikeRouteSelection = (segmentIndex, segmentPath, segmentColor) => {
    if (!segmentPath || !segmentColor) return;
    if (selectedBikeSegmentIndex === segmentIndex) {
      clearBikeRouteSelection();
      return;
    }

    if (selectedBikeSegmentIndex >= 0) {
      clearBikeRouteSelection(false);
    }

    const selectedLine = navigationBikeRouteMainList[segmentIndex];
    const selectedOutline = navigationBikeRouteOutlineList[segmentIndex];
    if (selectedLine) {
      selectedLine.setOptions({ zIndex: 20 });
      if (selectedOutline) {
        selectedOutline.setOptions({ zIndex: 20 });
      }
      const highlightLine = new kakaoRef.maps.Polyline({
        path: segmentPath,
        strokeColor: lightenHexColor(segmentColor, 60),
        strokeWeight: 16,
        strokeOpacity: 0.6,
        strokeStyle: 'solid',
        zIndex: 19,
      });
      highlightLine.setMap(mapRef);
      navigationBikeRouteHighlightLine = highlightLine;
      // 간단한 클릭 피드백 애니메이션
      selectedLine.setOptions({ strokeWeight: 10 });
      highlightLine.setOptions({ strokeOpacity: 0.8 });
      setTimeout(() => {
        selectedLine.setOptions({ strokeWeight: 8 });
        highlightLine.setOptions({ strokeOpacity: 0.6 });
      }, 150);
    }

    selectedBikeSegmentIndex = segmentIndex;
    updateArrowVisibilityByZoom();
  };

  // 폴리라인 클릭 시 해당 세그먼트 선택 처리
  const attachBikeRouteClick = (line, idx, segmentPath, segmentColor) => {
    if (!line) return;
    kakaoRef.maps.event.addListener(line, 'click', () => {
      setBikeRouteSelection(idx, segmentPath, segmentColor);
    });
  };

  // 경유지 기준으로 자전거 경로를 세그먼트로 분할
  const getBikeRouteSegmentsByWaypoints = (coords, waypoints) => {
    if (!Array.isArray(waypoints) || waypoints.length === 0) return null;
    let lastIdx = 0;
    const waypointIndices = [];

    waypoints.forEach(wp => {
      const exactIdx = findExactIndexOnPath(coords, wp.lat, wp.lng);
      const nearestIdx =
        exactIdx >= 0
          ? exactIdx
          : findNearestIndexOnPath(coords, wp.lat, wp.lng);
      if (nearestIdx >= 0 && nearestIdx > lastIdx) {
        waypointIndices.push(nearestIdx);
        lastIdx = nearestIdx;
      }
    });

    const splitPoints = [0, ...waypointIndices, coords.length - 1];
    const segments = [];
    for (let i = 0; i < splitPoints.length - 1; i++) {
      const start = splitPoints[i];
      const end = splitPoints[i + 1];
      if (end <= start) continue;
      segments.push(coords.slice(start, end + 1));
    }
    return segments.length > 0 ? segments : null;
  };

  // 대여소 기준으로 도보/자전거 구간을 분리
  const splitPathByStations = (
    coords,
    startStationPoint,
    endStationPoint,
    routeType,
  ) => {
    if (!startStationPoint || !endStationPoint) {
      return {
        walkingToStartCoords: [],
        bikeRouteCoords: coords,
        walkingToEndCoords: [],
        walkingToOriginCoords: [],
      };
    }
    // 출발대여소는 항상 존재한다고 가정
    const firstIdx = findNearestIndexOnPath(
      coords,
      startStationPoint.lat,
      startStationPoint.lng,
    );

    // endStation이 startStation과 같은 경우 = 대여소 1개 (원점 ↔ 대여소 ↔ 원점 루프)
    if (
      routeType === 'loop' &&
      endStationPoint.lat === startStationPoint.lat &&
      endStationPoint.lng === startStationPoint.lng
    ) {
      // 뒤에서부터 같은 대여소에 가장 가까운 인덱스 찾기 (마지막 대여소 지점)
      const reversedIdx = findNearestIndexOnPath(
        [...coords].reverse(),
        startStationPoint.lat,
        startStationPoint.lng,
      );
      const lastIdx = coords.length - 1 - reversedIdx;

      // 원점 → 대여소 + 대여소 → 원점 (도보)
      const walkingToOriginCoords = [
        ...coords.slice(0, firstIdx + 1),
        ...coords.slice(lastIdx),
      ];

      // 대여소 ↔ 대여소 구간만 자전거
      const bikeRouteCoords = coords.slice(firstIdx, lastIdx + 1);

      return {
        walkingToOriginCoords,
        bikeRouteCoords,
        walkingToStartCoords: [],
        walkingToEndCoords: [],
      };
    }

    // 출발/도착 대여소가 서로 다른 일반 케이스
    const startIdx = firstIdx;
    const endIdx = findNearestIndexOnPath(
      coords,
      endStationPoint.lat,
      endStationPoint.lng,
    );

    const sliceStart = Math.min(startIdx, endIdx);
    const sliceEnd = Math.max(startIdx, endIdx);

    return {
      walkingToStartCoords: coords.slice(0, sliceStart + 1),
      bikeRouteCoords: coords.slice(sliceStart, sliceEnd + 1),
      walkingToEndCoords: coords.slice(sliceEnd),
      walkingToOriginCoords: [],
    };
  };

  // 네비게이션 경로 및 마커 전체 초기화
  const clearNavigationPath = () => {
    if (startMarker) startMarker.setMap(null);
    if (endMarker) endMarker.setMap(null);
    if (originMarker) originMarker.setMap(null);
    if (startStationMarker) startStationMarker.setMap(null);
    if (endStationMarker) endStationMarker.setMap(null);
    if (kakaoPathForFocusOnBound.length > 0) kakaoPathForFocusOnBound = [];

    clearWaypointsMarkers();
    // 기존 경로 폴리라인들 전부 제거
    navigationBikeRouteOutlineList.forEach(polyline => {
      if (polyline) {
        polyline.setMap(null);
      }
    });
    navigationBikeRouteMainList.forEach(polyline => {
      if (polyline) {
        polyline.setMap(null);
      }
    });
    navigationBikeRouteGrayList.forEach(polyline => {
      if (polyline) {
        polyline.setMap(null);
      }
    });

    navigationBikeRouteOutlineList = [];
    navigationBikeRouteMainList = [];
    navigationBikeRouteGrayList = [];
    clearBikeRouteArrows();
    clearBikeRouteSelection();

    if (navigationWalkingToStartDot) {
      navigationWalkingToStartDot.setMap(null);
      navigationWalkingToStartDot.setPath([]);
    }

    if (navigationWalkingToEndDot) {
      navigationWalkingToEndDot.setMap(null);
      navigationWalkingToEndDot.setPath([]);
    }

    if (navigationWalkingToOriginDot) {
      navigationWalkingToOriginDot.setMap(null);
      navigationWalkingToOriginDot.setPath([]);
    }

    if (mapRef) {
      // no-op
    }
  };

  // interval 정보를 포함한 네비게이션 경로 렌더링
  const drawNavigationPath = navigationPathData => {
    const {
      routeType,
      startPoint,
      endPoint,
      waypoints,
      fullPathCoordinateList,
      intervals,
      currentIntervalIndex,
      startStationPoint,
      endStationPoint,
      walkingPolicy = 'all',
    } = navigationPathData;

    const shouldDrawStartWalking = walkingPolicy === 'all';
    const shouldDrawEndWalking =
      walkingPolicy === 'all' || walkingPolicy === 'only-end';

    clearNavigationPath();

    // 마커 찍기 - selectedRouteData 기반
    if (routeType === 'constant') {
      const [startLng, startLat] = startPoint;
      const [endLng, endLat] = endPoint;

      if (shouldDrawStartWalking) {
        const startPos = new kakaoRef.maps.LatLng(startLat, startLng);
        startMarker.setPosition(startPos);
        startMarker.setMap(mapRef);
      }

      if (shouldDrawEndWalking) {
        const endPos = new kakaoRef.maps.LatLng(endLat, endLng);
        endMarker.setPosition(endPos);
        endMarker.setMap(mapRef);
      }

      if (startStationPoint) {
        const startStationPos = new kakaoRef.maps.LatLng(
          startStationPoint.lat,
          startStationPoint.lng,
        );
        startStationMarker.setPosition(startStationPos);
        startStationMarker.setMap(mapRef);
      }
      if (endStationPoint) {
        const endStationPos = new kakaoRef.maps.LatLng(
          endStationPoint.lat,
          endStationPoint.lng,
        );
        endStationMarker.setPosition(endStationPos);
        endStationMarker.setMap(mapRef);
      }
      if (waypoints) {
        createWaypointsMarkers(waypoints);
      }
    }

    if (routeType === 'loop') {
      const [originLng, originLat] = startPoint;

      if (shouldDrawStartWalking) {
        const originPos = new kakaoRef.maps.LatLng(originLat, originLng);
        originMarker.setPosition(originPos);
        originMarker.setMap(mapRef);
      }

      if (startStationPoint) {
        const startStationPos = new kakaoRef.maps.LatLng(
          startStationPoint.lat,
          startStationPoint.lng,
        );
        startStationMarker.setPosition(startStationPos);
        startStationMarker.setMap(mapRef);
      }
      if (endStationPoint) {
        const endStationPos = new kakaoRef.maps.LatLng(
          endStationPoint.lat,
          endStationPoint.lng,
        );
        endStationMarker.setPosition(endStationPos);
        endStationMarker.setMap(mapRef);
      }
      if (waypoints) {
        createWaypointsMarkers(waypoints);
      }
    }

    kakaoPathForFocusOnBound = convertToKakaoLatLngArray(
      fullPathCoordinateList,
    );

    const {
      walkingToStartCoords,
      bikeRouteCoords,
      walkingToEndCoords,
      walkingToOriginCoords,
    } = splitPathByStations(
      fullPathCoordinateList,
      startStationPoint,
      endStationPoint,
      routeType,
    );

    // 도보 구간 점선 렌더링
    if (shouldDrawStartWalking) {
      if (walkingToStartCoords && walkingToStartCoords.length > 0) {
        const sampledWalkingToStartCoords = samplePathByDistance(
          walkingToStartCoords,
          WALKING_SAMPLE_DISTANCE_M,
        );
        const walkingToStartPath = convertToKakaoLatLngArray(
          sampledWalkingToStartCoords,
        );
        navigationWalkingToStartDot.setPath(walkingToStartPath);
        navigationWalkingToStartDot.setMap(mapRef);
      }

      if (walkingToOriginCoords && walkingToOriginCoords.length > 0) {
        const shouldUseHalfLoopWalking = routeType === 'loop';
        let walkingToOriginCoordsForRender = walkingToOriginCoords;
        if (shouldUseHalfLoopWalking) {
          const targetPoint =
            waypoints && waypoints.length > 0 ? waypoints[0] : null;
          if (targetPoint) {
            const exactIdx = findExactIndexOnPath(
              walkingToOriginCoords,
              targetPoint.lat,
              targetPoint.lng,
            );
            const nearestIdx =
              exactIdx >= 0
                ? exactIdx
                : findNearestIndexOnPath(
                    walkingToOriginCoords,
                    targetPoint.lat,
                    targetPoint.lng,
                  );
            if (nearestIdx > 0) {
              walkingToOriginCoordsForRender = walkingToOriginCoords.slice(
                0,
                nearestIdx + 1,
              );
            }
          } else {
            walkingToOriginCoordsForRender = walkingToOriginCoords.slice(
              0,
              Math.max(1, Math.floor(walkingToOriginCoords.length / 2)),
            );
          }
        }
        const sampledWalkingToOriginCoords = samplePathByDistance(
          walkingToOriginCoordsForRender,
          WALKING_SAMPLE_DISTANCE_M,
        );
        const walkingToOriginPath = convertToKakaoLatLngArray(
          sampledWalkingToOriginCoords,
        );
        navigationWalkingToOriginDot.setPath(walkingToOriginPath);
        navigationWalkingToOriginDot.setMap(mapRef);
      }
    }

    if (shouldDrawEndWalking) {
      if (walkingToEndCoords && walkingToEndCoords.length > 0) {
        const sampledWalkingToEndCoords = samplePathByDistance(
          walkingToEndCoords,
          WALKING_SAMPLE_DISTANCE_M,
        );
        const walkingToEndPath = convertToKakaoLatLngArray(
          sampledWalkingToEndCoords,
        );
        navigationWalkingToEndDot.setPath(walkingToEndPath);
        navigationWalkingToEndDot.setMap(mapRef);
      }
    }

    // 자전거 구간을 세그먼트/interval 단위로 렌더링
    if (bikeRouteCoords && bikeRouteCoords.length > 0 && intervals) {
      const shouldUseHalfLoopPath =
        routeType === 'loop' && waypoints && waypoints.length === 1;
      let bikeRouteCoordsForRender = bikeRouteCoords;
      if (shouldUseHalfLoopPath) {
        const exactIdx = findExactIndexOnPath(
          bikeRouteCoords,
          waypoints[0].lat,
          waypoints[0].lng,
        );
        const nearestIdx =
          exactIdx >= 0
            ? exactIdx
            : findNearestIndexOnPath(
                bikeRouteCoords,
                waypoints[0].lat,
                waypoints[0].lng,
              );
        if (nearestIdx > 0) {
          bikeRouteCoordsForRender = bikeRouteCoords.slice(0, nearestIdx + 1);
        }
      }

      // splitPathByStations가 이미 정확한 bikeRouteCoords를 추출함
      // fullPathCoordinateList에서 bikeRouteCoords의 시작 위치를 찾음
      const [firstLng, firstLat] = bikeRouteCoordsForRender[0];

      const bikeStartIdx = fullPathCoordinateList.findIndex(
        ([lng, lat]) => lng === firstLng && lat === firstLat,
      );

      // bikeEndIdx는 시작 인덱스 + 길이 - 1 (수학적으로 정확)
      const bikeEndIdx = bikeStartIdx + bikeRouteCoordsForRender.length - 1;

      // 전체 자전거 구간을 LatLng로 변환
      const fullBikeKakaoPath = convertToKakaoLatLngArray(
        bikeRouteCoordsForRender,
      );

      // interval 업데이트에서 재사용할 경로/인덱스 캐시
      cachedFullBikeKakaoPath = fullBikeKakaoPath;
      cachedIntervals = intervals;
      cachedBikeStartIdx = bikeStartIdx;

      const loopSegmentColors = ['#00E676', '#00B0FF', '#FF9100', '#FF4081'];
      const hasWaypointSegments = waypoints && waypoints.length >= 1;
      const segments = getBikeRouteSegmentsByWaypoints(
        bikeRouteCoordsForRender,
        waypoints,
      );

      if (segments && segments.length > 0) {
        segments.forEach((segmentCoords, idx) => {
          const segmentPath = convertToKakaoLatLngArray(segmentCoords);
          const segmentColor = hasWaypointSegments
            ? loopSegmentColors[idx % loopSegmentColors.length]
            : '#00E676';

          const outlineLine = new kakaoRef.maps.Polyline({
            path: segmentPath,
            strokeColor: darkenHexColor(segmentColor, 70),
            strokeWeight: 12,
            strokeOpacity: 0.95,
            strokeStyle: 'solid',
            zIndex: 5 + idx,
          });
          outlineLine.setMap(mapRef);
          navigationBikeRouteOutlineList.push(outlineLine);

          const segmentLine = new kakaoRef.maps.Polyline({
            path: segmentPath,
            strokeColor: segmentColor,
            strokeWeight: 8,
            strokeOpacity: 1,
            strokeStyle: 'solid',
            zIndex: 5 + idx,
          });
          segmentLine.setMap(mapRef);
          navigationBikeRouteMainList.push(segmentLine);
          attachBikeRouteClick(segmentLine, idx, segmentPath, segmentColor);
          attachBikeRouteClick(outlineLine, idx, segmentPath, segmentColor);

          const useAlternate =
            routeType === 'loop' && waypoints && waypoints.length === 1;
          createBikeRouteArrows(
            segmentCoords,
            segmentColor,
            useAlternate,
            5 + idx,
          );
        });
      } else {
        const bikeRouteMain = new kakaoRef.maps.Polyline({
          path: fullBikeKakaoPath,
          strokeColor: '#00E676',
          strokeWeight: 8,
          strokeOpacity: 1,
          strokeStyle: 'solid',
          zIndex: 5,
        });
        const bikeRouteOutline = new kakaoRef.maps.Polyline({
          path: fullBikeKakaoPath,
          strokeColor: darkenHexColor('#00E676', 70),
          strokeWeight: 12,
          strokeOpacity: 0.95,
          strokeStyle: 'solid',
          zIndex: 5,
        });
        bikeRouteOutline.setMap(mapRef);
        navigationBikeRouteOutlineList.push(bikeRouteOutline);
        bikeRouteMain.setMap(mapRef);
        navigationBikeRouteMainList.push(bikeRouteMain);
        attachBikeRouteClick(bikeRouteMain, 0, fullBikeKakaoPath, '#00E676');
        attachBikeRouteClick(bikeRouteOutline, 0, fullBikeKakaoPath, '#00E676');

        const useAlternate =
          routeType === 'loop' && waypoints && waypoints.length === 1;
        createBikeRouteArrows(
          bikeRouteCoordsForRender,
          '#00E676',
          useAlternate,
          5,
        );
      }

      // 지나온 구간이 있으면 회색 라인으로 덮어그리기
      if (currentIntervalIndex > 0) {
        // 지나온 마지막 interval의 끝 인덱스 찾기
        let passedEndIdx = 0;
        for (let i = 0; i < currentIntervalIndex; i++) {
          const [intervalStart, intervalEnd] = intervals[i];
          // 자전거 구간 내에서만 계산
          if (intervalEnd >= bikeStartIdx && intervalStart <= bikeEndIdx) {
            const actualEnd = Math.min(intervalEnd, bikeEndIdx);
            passedEndIdx = actualEnd - bikeStartIdx;
          }
        }

        // 지나온 구간 경로 추출
        const passedPath = fullBikeKakaoPath.slice(0, passedEndIdx + 1);

        if (passedPath.length > 1) {
          const passedMain = new kakaoRef.maps.Polyline({
            path: passedPath,
            strokeColor: '#A0A0A0',
            strokeWeight: 8,
            strokeOpacity: 0.6,
            strokeStyle: 'solid',
            zIndex: 6,
          });
          passedMain.setMap(mapRef);
          navigationBikeRouteGrayList.push(passedMain);
        }
      }

      focusOnNavigationPath();
    }
  };

  // interval 변경 시 지나온 구간을 다시 회색 처리
  const updateNavigationCurrentInterval = currentIntervalIndex => {
    // 기존 회색 구간 제거
    navigationBikeRouteGrayList.forEach(polyline => polyline.setMap(null));
    navigationBikeRouteGrayList = [];

    if (currentIntervalIndex === 0) return; // 지나온 구간 없음
    if (cachedFullBikeKakaoPath.length === 0) return; // 캐시된 데이터 없음

    // 지나온 마지막 interval의 끝 인덱스 찾기
    let passedEndIdx = 0;
    const bikeEndIdx = cachedBikeStartIdx + cachedFullBikeKakaoPath.length - 1;

    for (let i = 0; i < currentIntervalIndex; i++) {
      const [intervalStart, intervalEnd] = cachedIntervals[i];
      // 자전거 구간 내에서만 계산
      if (intervalEnd >= cachedBikeStartIdx && intervalStart <= bikeEndIdx) {
        const actualEnd = Math.min(intervalEnd, bikeEndIdx);
        passedEndIdx = actualEnd - cachedBikeStartIdx;
      }
    }

    // 지나온 구간 경로 추출
    const passedPath = cachedFullBikeKakaoPath.slice(0, passedEndIdx + 1);

    if (passedPath.length > 1) {
      const passedMain = new kakaoRef.maps.Polyline({
        path: passedPath,
        strokeColor: '#A0A0A0',
        strokeWeight: 8,
        strokeOpacity: 0.6,
        strokeStyle: 'solid',
        zIndex: 6,
      });
      passedMain.setMap(mapRef);
      navigationBikeRouteGrayList.push(passedMain);
    }
  };

  // 바운드 맞추기
  const focusOnNavigationPath = () => {
    const bounds = new kakaoRef.maps.LatLngBounds();
    kakaoPathForFocusOnBound.forEach(latlng => bounds.extend(latlng));
    mapRef.setBounds(bounds, 100);
  };

  window.Navigation = {
    initNavigationSetting,
    drawNavigationPath,
    updateNavigationCurrentInterval,
    clearNavigationPath,
    focusOnNavigationPath,
  };
})();
