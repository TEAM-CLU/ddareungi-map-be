/**
 * 텍스트 정규화 유틸리티
 * TTS 캐싱을 위해 텍스트를 정규화합니다.
 */
export function normalizeText(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}
