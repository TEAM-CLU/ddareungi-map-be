/**
 * Stations 도메인 전용 인터페이스
 */

/**
 * GeoJSON 기본 구조
 */
export interface GeoJSONGeometry {
  type: 'Point';
  coordinates: [number, number]; // [경도, 위도]
}

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: GeoJSONGeometry;
  properties: {
    id: string;
    name: string;
    number?: string;
    total_racks: number;
    current_adult_bikes: number;
    status: 'available' | 'empty';
    last_updated_at?: Date;
  };
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

/**
 * 동기화 결과 인터페이스
 */
export interface SyncResult {
  created: number;
  updated: number;
  failed: number;
  total: number;
}

export interface RealtimeUpdateData {
  current_adult_bikes: number;
  total_racks: number;
  status: 'available' | 'empty';
  last_updated_at: Date;
}

export interface SyncRealtimeDetail {
  stationId: string;
  stationName: string;
  status: 'success' | 'failed';
  parkingBikeTotCnt?: number;
  rackTotCnt?: number;
  error?: string;
}

export interface DeleteAllResult {
  deletedCount: number;
}

export interface StationSyncDetail {
  stationId: string;
  stationName: string;
  action: 'created' | 'updated' | 'failed';
  error?: string;
}

export interface SyncStatusInfo {
  latestSync: any;
  lastSuccessSync: any;
  needsSync: boolean;
  isOverdue: boolean;
}
