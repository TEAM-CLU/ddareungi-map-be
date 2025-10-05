// GraphHopper API 응답 인터페이스
export interface GraphHopperResponse {
  paths: GraphHopperPath[];
  info: {
    took: number;
  };
}

export interface GraphHopperPath {
  distance: number;
  time: number;
  ascend: number;
  descend: number;
  points: {
    coordinates: number[][];
  };
  bbox: [number, number, number, number];
  instructions: GraphHopperInstruction[];
  details?: {
    road_class?: [number, number, string][];
    bike_network?: [number, number, string][];
  };
  profile?: string; // 경로 계산에 사용된 프로필 정보
}

export interface GraphHopperInstruction {
  distance: number;
  time: number;
  text: string;
  sign: number;
  interval: [number, number];
}
