  // interval 정보를 포함한 네비게이션 경로 렌더링
  const drawNavigationPath = navigationPathData => {
    const {
      routeType,
      startPoint,
      endPoint,
      originPoint = null, // RN에서 전달한 원점(없으면 startPoint fallback)
      pathMode = 'normal', // normal | loop-recovery
      waypoints,
      fullPathCoordinateList,
      intervals,
      currentIntervalIndex,
      startStationPoint,
      endStationPoint,
      walkingPolicy = 'all',
    } = navigationPathData;

    const isLoopRecoveryMode =
      routeType === 'loop' && pathMode === 'loop-recovery';

    const shouldDrawStartWalking = walkingPolicy === 'all';
    const shouldDrawEndWalking =
      walkingPolicy === 'all' || walkingPolicy === 'only-end';

    clearNavigationPath();

    // 마커 찍기
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
      const [fallbackOriginLng, fallbackOriginLat] = startPoint;
      const [originLng, originLat] =
        originPoint ?? [fallbackOriginLng, fallbackOriginLat];

      // loop-recovery라도 원점 마커는 항상 원래 원점에 표시
      if (shouldDrawStartWalking || isLoopRecoveryMode) {
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

    let walkingToStartCoords = [];
    let bikeRouteCoords = fullPathCoordinateList;
    let walkingToEndCoords = [];
    let walkingToOriginCoords = [];

    // loop-recovery는 원점↔대여소 도보 구간을 분리해서 표시
    if (isLoopRecoveryMode) {
      const loopRecoverySegments = buildLoopRecoverySegments(
        fullPathCoordinateList,
        startStationPoint,
        originPoint,
      );
      bikeRouteCoords = loopRecoverySegments.bikeRouteCoords;
      walkingToOriginCoords = loopRecoverySegments.walkingToOriginCoords;
    } else {
      const splitResult = splitPathByStations(
        fullPathCoordinateList,
        startStationPoint,
        endStationPoint,
        routeType,
      );

      walkingToStartCoords = splitResult.walkingToStartCoords;
      bikeRouteCoords = splitResult.bikeRouteCoords;
      walkingToEndCoords = splitResult.walkingToEndCoords;
      walkingToOriginCoords = splitResult.walkingToOriginCoords;
    }

    // 도보 구간 점선 렌더링 (일반 모드)
    if (shouldDrawStartWalking && !isLoopRecoveryMode) {
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

    // loop-recovery 전용: 원점↔대여소 도보 점선 렌더링
    if (isLoopRecoveryMode) {
      if (walkingToOriginCoords && walkingToOriginCoords.length > 0) {
        const sampledWalkingToOriginCoords = samplePathByDistance(
          walkingToOriginCoords,
          WALKING_SAMPLE_DISTANCE_M,
        );
        const walkingToOriginPath = convertToKakaoLatLngArray(
          sampledWalkingToOriginCoords,
        );
        navigationWalkingToOriginDot.setPath(walkingToOriginPath);
        navigationWalkingToOriginDot.setMap(mapRef);
      }
    }

    if (shouldDrawEndWalking && !isLoopRecoveryMode) {
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
        routeType === 'loop' &&
        waypoints &&
        waypoints.length === 1 &&
        !isLoopRecoveryMode;

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

      // fullPathCoordinateList에서 bikeRouteCoords의 시작 위치를 찾음
      const [firstLng, firstLat] = bikeRouteCoordsForRender[0];

      const bikeStartIdx = fullPathCoordinateList.findIndex(
        ([lng, lat]) => lng === firstLng && lat === firstLat,
      );

      // bikeEndIdx는 시작 인덱스 + 길이 - 1
      const bikeEndIdx = bikeStartIdx + bikeRouteCoordsForRender.length - 1;

      const fullBikeKakaoPath = convertToKakaoLatLngArray(
        bikeRouteCoordsForRender,
      );

      // interval 업데이트에서 재사용할 경로/인덱스 캐시
      cachedFullBikeKakaoPath = fullBikeKakaoPath;
      cachedIntervals = intervals;
      cachedBikeStartIdx = bikeStartIdx;

      const loopSegmentColors = ['#00E676', '#00B0FF', '#FF9100', '#FF4081'];

      // loop-recovery는 복귀+잔여 자전거 구간을 단일 경로로 렌더
      const hasWaypointSegments =
        !isLoopRecoveryMode && waypoints && waypoints.length >= 1;
      const segments = !isLoopRecoveryMode
        ? getBikeRouteSegmentsByWaypoints(bikeRouteCoordsForRender, waypoints)
        : null;

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
            routeType === 'loop' &&
            waypoints &&
            waypoints.length === 1 &&
            !isLoopRecoveryMode;

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
          routeType === 'loop' &&
          waypoints &&
          waypoints.length === 1 &&
          !isLoopRecoveryMode;

        createBikeRouteArrows(
          bikeRouteCoordsForRender,
          '#00E676',
          useAlternate,
          5,
        );
      }

      // 지나온 구간이 있으면 회색 라인으로 덮어그리기
      if (currentIntervalIndex > 0) {
        let passedEndIdx = 0;

        for (let i = 0; i < currentIntervalIndex; i++) {
          const [intervalStart, intervalEnd] = intervals[i];
          if (intervalEnd >= bikeStartIdx && intervalStart <= bikeEndIdx) {
            const actualEnd = Math.min(intervalEnd, bikeEndIdx);
            passedEndIdx = actualEnd - bikeStartIdx;
          }
        }

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
