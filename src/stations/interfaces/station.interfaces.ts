/**
 * Stations 도메인 전용 인터페이스
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
