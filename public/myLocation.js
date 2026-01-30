(function () {
  // 지도/카카오 참조 및 내 위치 오버레이 상태
  let kakaoRef, mapRef;
  let myLocationMarker, myHeadingOverlay, outerCircle, innerCircle;
  let hasMoveToMyLocationRun = false;
  let defaultMyLocationContent = null;

  // 내 위치 마커/방향/정확도 원 초기 설정
  const initMyLocationSetting = (kakao, map, DEFAULT_LAT, DEFAULT_LNG) => {
    kakaoRef = kakao;
    mapRef = map;
    const defaultPos = new kakaoRef.maps.LatLng(DEFAULT_LAT, DEFAULT_LNG);

    //  내 위치 마커 생성 및 초기세팅
    const myLocationSvg = `
                        <div style="
                          position: absolute;
                          top: 50%;
                          left: 50%;
                          transform: translate(-50%, -50%);
                          display: flex;
                          align-items: center;
                          justify-content: center;
                          width: 23px;
                          height: 23px;
                        ">
                          <svg xmlns='http://www.w3.org/2000/svg' width='23' height='23' viewBox='0 0 23 23' fill='none'>
                            <circle cx='11.7393' cy='11.739' r='9.5' fill='#01DA86' stroke='white' stroke-width='3'/>
                          </svg>
                        </div>
                      `;
    myLocationMarker = new kakaoRef.maps.CustomOverlay({
      position: defaultPos,
      content: myLocationSvg,
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: 20,
    });
    defaultMyLocationContent = myLocationSvg;
    myLocationMarker.setMap(mapRef);

    // 내 위치 방향 cone 생성 및 초기세팅
    const myHeadingSvg = `
                      <div id="myHeadingOverlay"
                          style="
                            position:absolute;
                            width:40px; height:40px;
                            transform-origin: 0px 1px;
                            transform: rotate(0deg);
                            pointer-events:none; z-index:2;">
                        <svg xmlns="http://www.w3.org/2000/svg"
                            width="40" height="40" viewBox="0 0 40 40" fill="none"
                            style="display:block; overflow:visible">
                          <path d="M0 1 L39 -11 A40 40 0 0 1 39 13 Z"
                                fill="url(#grad)" />
                          <defs>
                            <radialGradient id="grad" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse"
                                            gradientTransform="translate(0 1) scale(45)">
                              <stop offset="0" stop-color="#01EC91"/>
                              <stop offset="1" stop-color="#01EC91" stop-opacity="0"/>
                            </radialGradient>
                          </defs>
                        </svg>
                      </div>
                      `;

    myHeadingOverlay = new kakaoRef.maps.CustomOverlay({
      position: defaultPos,
      content: myHeadingSvg,
      xAnchor: 0,
      yAnchor: 0.5,
      zIndex: 1,
    });
    myHeadingOverlay.setMap(null); // 초기에는 숨김

    // 정확도 원
    outerCircle = new kakaoRef.maps.Circle({
      center: defaultPos,
      radius: 20, // 초기 반경
      strokeWeight: 0,
      fillColor: '#01DA86',
      fillOpacity: 0.1,
    });
    outerCircle.setMap(mapRef);
    innerCircle = new kakaoRef.maps.Circle({
      center: defaultPos,
      radius: 10, // 초기 반경
      strokeWeight: 0,
      fillColor: '#01DA86',
      fillOpacity: 0.2,
    });
    innerCircle.setMap(mapRef);
  };

  // 내 위치 좌표와 정확도 반경 업데이트
  const updateMyLocation = (lat, lng, accuracy) => {
    const updatedPosition = new kakaoRef.maps.LatLng(lat, lng);

    // 최초 위치로 이동
    if (!hasMoveToMyLocationRun && !window.isSelectedRouteDetailModalOpen) {
      mapRef.panTo(updatedPosition);
      hasMoveToMyLocationRun = true;
    }
    myLocationMarker.setPosition(updatedPosition);
    myHeadingOverlay.setPosition(updatedPosition);
    outerCircle.setPosition(updatedPosition);
    innerCircle.setPosition(updatedPosition);
    // 정확도 반경 업데이트 (최소값 설정)
    outerCircle.setRadius(Math.max(accuracy, 15));
    innerCircle.setRadius(Math.max(accuracy / 2, 8));

    // 나침반 모드일 때만 내 위치 고정 이동
    if (window.isCompassMode) mapRef.panTo(updatedPosition);
  };

  // 나침반/네비게이션 방향 회전 적용
  const rotateMyHeading = heading => {
    if (!kakaoRef || !mapRef) {
      return;
    }
    const myHeadingElement = document.getElementById('myHeadingOverlay');
    if (myHeadingElement) {
      myHeadingElement.style.transform = `rotate(${heading - 90}deg)`;
    }
    const navigationMarkerArrow = document.getElementById(
      'myNavigationMarkerArrow',
    );
    if (navigationMarkerArrow) {
      navigationMarkerArrow.style.transform = `rotate(${heading}deg)`;
    }
  };

  // 나침반 오버레이 표시 여부 토글
  const setMyHeadingOverlayVisible = isCompassMode => {
    myHeadingOverlay.setMap(isCompassMode ? mapRef : null);
  };

  // 네비게이션 모드에서 내 위치 마커 콘텐츠 교체
  const replaceMyLocationMarker = isNavigationMode => {
    if (!myLocationMarker) return;
    const myLocationSvgForNavigation = `
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          align-items: center;
          justify-content: center;
          width: 23px;
          height: 23px;
        ">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="23"
            height="23"
            viewBox="0 0 24 24"
            fill="none"
            id="myNavigationMarkerArrow"
            style="transform: rotate(-90deg); transform-origin: 12px 12px;"
          >
            <!-- 흰색 배경 (여백 채우기용) -->
            <circle cx="12" cy="12" r="11" fill="#FFFFFF"/>

            <!-- 네비게이션 아이콘 -->
            <path
              d="M7.975 17L12 15.175L16.025 17L16.4 16.625L12 6L7.6 16.625L7.975 17Z
                M12 22C10.6167 22 9.31667 21.7373 8.1 21.212
                C6.88334 20.6867 5.825 19.9743 4.925 19.075
                C4.025 18.1757 3.31267 17.1173 2.788 15.9
                C2.26333 14.6827 2.00067 13.3827 2 12
                C1.99933 10.6173 2.262 9.31733 2.788 8.1
                C3.314 6.88267 4.02633 5.82433 4.925 4.925
                C5.82367 4.02567 6.882 3.31333 8.1 2.788
                C9.318 2.26267 10.618 2 12 2
                C13.382 2 14.682 2.26267 15.9 2.788
                C17.118 3.31333 18.1763 4.02567 19.075 4.925
                C19.9737 5.82433 20.6863 6.88267 21.213 8.1
                C21.7397 9.31733 22.002 10.6173 22 12
                C21.998 13.3827 21.7353 14.6827 21.212 15.9
                C20.6887 17.1173 19.9763 18.1757 19.075 19.075
                C18.1737 19.9743 17.1153 20.687 15.9 21.213
                C14.6847 21.739 13.3847 22.0013 12 22Z"
              fill="#01DA86"
            />
          </svg>
        </div>
        `;

    myLocationMarker.setContent(
      isNavigationMode ? myLocationSvgForNavigation : defaultMyLocationContent,
    );
  };

  window.MyLocation = {
    initMyLocationSetting,
    updateMyLocation,
    rotateMyHeading,
    setMyHeadingOverlayVisible,
    replaceMyLocationMarker,
  };

  Object.defineProperty(window.MyLocation, 'myLocationMarker', {
    get() {
      return myLocationMarker;
    },
  });
})();
