(function () {
  // 지도/카카오 참조 및 즐겨찾기 마커 상태
  let kakaoRef, mapRef;
  let bookmarkMarkers = [];

  // 즐겨찾기 기능 초기 설정
  const initBookmarkSetting = (kakao, map) => {
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
    .bookmark-marker, .bookmark-marker * {
      -webkit-tap-highlight-color: rgba(0,0,0,0);
      -webkit-touch-callout: none;
      user-select: none;
      -webkit-user-select: none;
      outline: none;
    }
    .bookmark-marker:active { background: transparent !important; }
    .bookmark-marker svg text {
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
    }
  `;
    document.head.appendChild(s);
  };

  // 즐겨찾기 마커 SVG 생성 함수
  const getBookmarkMarkerSvg = (color = '#01DA86', uniqueId) => `
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g filter="url(#filter_badge_shadow_${uniqueId})">
        <circle cx="22" cy="20" r="16" fill="white"/>
        
        <circle cx="22" cy="20" r="14" fill="${color}"/>
        
        <path d="M22 13L24.5 17.8L29.8 18.3L25.8 21.9L27 27.1L22 24.2L17 27.1L18.2 21.9L14.2 18.3L19.5 17.8L22 13Z" 
          fill="white"
        />
      </g>
      <defs>
        <filter id="filter_badge_shadow_${uniqueId}" x="0" y="0" width="44" height="44" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
          <feFlood flood-opacity="0" result="BackgroundImageFix"/>
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
          <feOffset dy="3"/>
          <feGaussianBlur stdDeviation="2"/>
          <feComposite in2="hardAlpha" operator="out"/>
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow"/>
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape"/>
        </filter>
      </defs>
    </svg>
  `;

  // 텍스트 이스케이프 처리 (악성 스크립트 별칭 저장 시 XSS 공격 방지)
  const escapeHtml = str => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  // DOM 엘리먼트 생성
  const buildBookmarkContentElement = (bookmark, index) => {
    const wrap = document.createElement('div');
    const color = bookmark.color || '#01DA86';

    // 1. 라벨 텍스트 결정 (별칭 우선 -> 없으면 장소명 -> 없으면 공백)
    const labelText = escapeHtml(bookmark.alias || bookmark.name || '');

    // SVG 필터 ID 충돌 방지를 위한 고유 ID 생성
    const uniqueId = `bm_${index}_${Math.floor(Math.random() * 1000)}`;

    // 2. 마커 아이콘 SVG
    const iconSvg = getBookmarkMarkerSvg(color, uniqueId);

    // 3. 라벨 HTML (마커 아래쪽에 위치)
    const labelHtml = `
      <div style="
        position: absolute;
        top: 40px; 
        left: 50%;
        transform: translateX(-50%);
        font-size: 11px;
        font-weight: bold;
        color: #374151; 
        text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff; 
        white-space: nowrap;
        max-width: 80px;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: center;
        z-index: 30;
      ">
        ${labelText}
      </div>
    `;

    // 아이콘 + 라벨 합치기
    wrap.innerHTML = iconSvg + labelHtml;

    wrap.className = 'bookmark-marker';
    wrap.style.width = '44px';
    wrap.style.height = '44px';
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';
    wrap.style.cursor = 'pointer';
    wrap.style.zIndex = '20';
    wrap.style.transform = 'translateZ(0)';
    wrap.style.background = 'transparent';
    wrap.style.overflow = 'visible';
    return wrap;
  };

  // 클릭 이벤트 바인딩
  const bindOverlayClick = (marker, bookmarkData) => {
    const content = marker.getContent();
    if (!content) return;

    content.onclick = null;
    content.onclick = () => {
      const position = marker.getPosition();
      const currentLevel = mapRef.getLevel();
      if (currentLevel > 3) {
        smoothPanAndZoom(position, 3);
      } else {
        mapRef.panTo(position);
      }

      window.ReactNativeWebView?.postMessage(
        JSON.stringify({
          type: 'clickBookmarkMarker',
          bookmarkData: bookmarkData,
        }),
      );
    };
  };

  // 모든 즐겨찾기 마커 정리
  const clearBookmarkMarkers = () => {
    if (bookmarkMarkers.length > 0) {
      bookmarkMarkers.forEach(({ marker }) => marker.setMap(null));
      bookmarkMarkers = [];
    }
  };

  // 즐겨찾기 목록을 지도 마커로 렌더링
  const createBookmarkMarkers = bookmarksList => {
    clearBookmarkMarkers();

    if (!bookmarksList || bookmarksList.length === 0) return;

    bookmarksList.forEach((bookmark, index) => {
      if (!bookmark.latitude || !bookmark.longitude) return;

      const position = new kakaoRef.maps.LatLng(
        bookmark.latitude,
        bookmark.longitude,
      );

      const contentElement = buildBookmarkContentElement(bookmark, index);

      const marker = new kakaoRef.maps.CustomOverlay({
        position: position,
        content: contentElement,
        xAnchor: 0.5,
        yAnchor: 0.45,
        zIndex: 20,
        clickable: true,
      });

      marker.setMap(mapRef);

      bookmarkMarkers.push({
        id: bookmark.id,
        marker: marker,
        metaData: bookmark,
      });

      bindOverlayClick(marker, bookmark);
    });
  };

  // 즐겨찾기 마커 표시 여부 토글
  const toggleBookmarkMarkers = isVisible => {
    if (bookmarkMarkers.length === 0) return;
    bookmarkMarkers.forEach(({ marker }) => {
      marker.setMap(isVisible ? mapRef : null);
    });
  };

  // 단일 즐겨찾기 마커 표시 (토글 상태와 무관하게 검색 시 사용)
  const showSingleBookmarkMarker = bookmarkData => {
    if (!bookmarkData || !bookmarkData.latitude || !bookmarkData.longitude)
      return;

    // 기존에 같은 ID의 마커가 있으면 재활용
    const existing = bookmarkMarkers.find(item => item.id === bookmarkData.id);
    if (existing) {
      // 토글 off 상태에서도 보이도록 명시적으로 setMap 호출
      existing.marker.setMap(mapRef);
      smoothPanAndZoom(existing.marker.getPosition(), 3);
      return;
    }

    // 새로 생성
    const position = new kakaoRef.maps.LatLng(
      bookmarkData.latitude,
      bookmarkData.longitude,
    );

    const uniqueId = `single_${bookmarkData.id}_${Math.floor(
      Math.random() * 1000,
    )}`;
    const contentElement = buildBookmarkContentElement(bookmarkData, uniqueId);

    const marker = new kakaoRef.maps.CustomOverlay({
      position: position,
      content: contentElement,
      xAnchor: 0.5,
      yAnchor: 0.45,
      zIndex: 20,
      clickable: true,
    });

    marker.setMap(mapRef);

    bookmarkMarkers.push({
      id: bookmarkData.id,
      marker: marker,
      metaData: bookmarkData,
    });

    bindOverlayClick(marker, bookmarkData);

    // 해당 마커로 포커스
    smoothPanAndZoom(position, 3);
  };

  const destroyBookmark = () => {
    clearBookmarkMarkers();
  };

  window.Bookmark = {
    initBookmarkSetting,
    createBookmarkMarkers,
    toggleBookmarkMarkers,
    showSingleBookmarkMarker,
    destroyBookmark,
  };
})();
