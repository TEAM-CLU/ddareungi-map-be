export type CacheType = 'temporary' | 'permanent';

export interface StoredMessageItem {
  hash: string;
  text: string;
  textKo: string;
  lang: string;
  voice?: string;
  createdAt: number;
  updatedAt?: number;
  url?: string;
  storageKey?: string;
}

export interface SplitChunk {
  text: string;
  cacheType: CacheType;
}
