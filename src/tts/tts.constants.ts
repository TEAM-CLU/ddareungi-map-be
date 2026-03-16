export const REDIS_PREFIX = 'tts:phrase:';
export const REDIS_TTL = 86400 * 3;
export const REDIS_TTL_PERMANENT = 86400 * 365 * 10;

export const STORAGE_BUCKET = 'tts';
export const STORAGE_PATH_TEMP = 'temporary';
export const STORAGE_PATH_PERMANENT = 'permanent';
export const STORAGE_PATH_MERGED = 'merged';

export const ACTION_SUFFIXES = [
  '좌회전입니다',
  '우회전입니다',
  '직진입니다',
  '진행입니다',
  '유턴입니다',
] as const;

export const DIRECTION_PREFIXES = [
  '좌측으로',
  '우측으로',
  '왼쪽으로',
  '오른쪽으로',
  '앞으로',
  '뒤로',
] as const;
