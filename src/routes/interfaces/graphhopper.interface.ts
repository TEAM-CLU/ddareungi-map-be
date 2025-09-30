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
  ascent: number;
  descent: number;
  points: {
    coordinates: number[][];
  };
  bbox: [number, number, number, number];
  instructions: GraphHopperInstruction[];
}

export interface GraphHopperInstruction {
  distance: number;
  time: number;
  text: string;
  sign: number;
  interval: [number, number];
}
