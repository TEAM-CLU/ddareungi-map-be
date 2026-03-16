import { Injectable } from '@nestjs/common';
import { TranslationService } from '../translation.service';
import { normalizeText } from '../utils/normalize-text';
import { ACTION_SUFFIXES, DIRECTION_PREFIXES } from '../tts.constants';
import { SplitChunk } from '../types/tts-cache.types';

@Injectable()
export class TtsTextChunkService {
  constructor(private readonly translationService: TranslationService) {}

  private takeLeadingToken(
    input: string,
    candidates: readonly string[],
  ): { token?: string; remaining: string } {
    const trimmed = input.trim();

    for (const candidate of candidates) {
      if (trimmed === candidate) {
        return { token: candidate, remaining: '' };
      }

      if (trimmed.startsWith(`${candidate} `)) {
        return {
          token: candidate,
          remaining: trimmed.slice(candidate.length).trim(),
        };
      }
    }

    return { remaining: trimmed };
  }

  normalizeTemporaryText(text: string): string {
    const normalized = normalizeText(text).replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return '';
    }

    const textKo = /[A-Za-z]/.test(normalized)
      ? this.translationService.translateToKorean(normalized)
      : normalized;

    return normalizeText(textKo).replace(/\s+/g, ' ').trim();
  }

  splitNavigationText(text: string): SplitChunk[] {
    const normalized = this.normalizeTemporaryText(text);
    if (!normalized) {
      return [];
    }

    const chunks: SplitChunk[] = [];
    let remaining = normalized;
    let actionSuffix: string | undefined;

    for (const action of ACTION_SUFFIXES) {
      if (remaining.endsWith(action)) {
        actionSuffix = action;
        remaining = remaining.slice(0, -action.length).trim();
        break;
      }
    }

    const directionToken = this.takeLeadingToken(remaining, DIRECTION_PREFIXES);
    if (directionToken.token) {
      chunks.push({ text: directionToken.token, cacheType: 'permanent' });
      remaining = directionToken.remaining;
    }

    if (remaining) {
      chunks.push({ text: remaining, cacheType: 'temporary' });
    }

    if (actionSuffix) {
      chunks.push({ text: actionSuffix, cacheType: 'permanent' });
    }

    return chunks.length > 0
      ? chunks
      : [{ text: normalized, cacheType: 'temporary' }];
  }
}
