import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { normalizeText } from './utils/normalize-text';

/**
 * 상수 정의
 */
const KOREAN_REGEX = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;
// `onto` 뒤 도로명 추출 (공백 포함) + 괄호 내용은 제외
// 예: "Turn sharp right onto 중랑천 자전거길 출입로 (노원고 방면)" -> "중랑천 자전거길 출입로"
const KOREAN_ROAD_REGEX = /onto\s+([가-힣0-9][^()]*)/i;
const WAYPOINT_REGEX = /Waypoint\s+(\d+)/i;
const ARRIVAL_KO_REGEX = /도착했습니다$/;

/**
 * 방향 인스트럭션 매핑 (GraphHopper instruction → 한글 안내)
 * 순서 중요: 긴 패턴부터 매칭
 */
const DIRECTION_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // U-turn
  [/Make a U-turn/i, '유턴'],
  // Sharp/Slight turns -> 단순화
  [/Turn sharp left/i, '좌회전'],
  [/Turn sharp right/i, '우회전'],
  [/Turn slight left/i, '좌측으로 계속 진행'],
  [/Turn slight right/i, '우측으로 계속 진행'],
  // Regular turns
  [/Turn left/i, '좌회전'],
  [/Turn right/i, '우회전'],
  // Keep direction
  [/Keep left/i, '좌측으로 계속 진행'],
  [/Keep right/i, '우측으로 계속 진행'],
  // Continue
  [/Continue/i, '직진'],
  // Arrival
  [/Arrive at start station/i, '출발 대여소에 도착했습니다'],
  [/Arrive at end station/i, '도착 대여소에 도착했습니다'],
  [/Arrive at destination/i, '목적지에 도착했습니다'],
  [/Arrive at waypoint/i, '경유지에 도착했습니다'],
  // Roundabout
  [/Roundabout/i, '로터리 진입'],
] as const;

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  /**
   * 영어 인스트럭션을 한글로 번역
   * Google Cloud Translation API 또는 간단한 매핑을 사용
   */
  translateToKorean(text: string): string {
    // 텍스트 정규화
    const normalized = normalizeText(text);

    // 항상 번역 시도 (한글 도로명 포함된 영어 문장도 처리)
    return this.simpleTranslate(normalized);
  }

  /**
   * 한글 포함 여부 확인
   */
  private containsKorean(text: string): boolean {
    return KOREAN_REGEX.test(text);
  }

  /**
   * 간단한 패턴 매칭 번역
   */
  private simpleTranslate(text: string): string {
    // 1. Waypoint 특수 처리
    const waypointMatch = text.match(WAYPOINT_REGEX);
    if (waypointMatch) {
      return `경유지 ${waypointMatch[1]}`;
    }

    // 2. 도로명 추출 (한글 도로명 보존)
    const roadNameMatch = text.match(KOREAN_ROAD_REGEX);
    const roadNameRaw = roadNameMatch?.[1] ?? null;
    const roadName =
      roadNameRaw
        ?.replace(/\s*\(.*$/, '') // 괄호 내용 제거
        .trim()
        .replace(/\s+/g, ' ') || null;

    // 3. 방향 매칭
    let direction = '';
    for (const [pattern, koreanDirection] of DIRECTION_PATTERNS) {
      if (pattern.test(text)) {
        direction = koreanDirection;
        break;
      }
    }

    const isArrivalKorean = (value: string): boolean =>
      ARRIVAL_KO_REGEX.test(value);

    // 4. 도로명과 방향 결합
    if (roadName && direction) {
      if (direction === '직진') {
        return `${roadName}로 직진입니다`;
      } else if (direction === '유턴') {
        return `${roadName}에서 유턴입니다`;
      } else if (direction === '좌회전' || direction === '우회전') {
        return `${roadName}로 ${direction}입니다`;
      } else if (
        direction === '좌측으로 계속' ||
        direction === '우측으로 계속'
      ) {
        return `${roadName} ${direction}입니다`;
      } else if (isArrivalKorean(direction)) {
        return direction;
      } else {
        return `${roadName}로 진입입니다`;
      }
    }

    // 5. 도로명 없이 방향만
    if (direction) {
      if (isArrivalKorean(direction)) {
        return direction;
      }
      return `${direction}입니다`;
    }

    // 6. 매칭 실패 시 원본 반환
    return text;
  }

  /**
   * Google Cloud Translation API를 사용한 번역 (옵션)
   */
  async translateWithGoogleAPI(text: string): Promise<string> {
    try {
      const apiKey = this.configService.get<string>('GOOGLE_TRANSLATE_API_KEY');
      if (!apiKey) {
        this.logger.warn(
          'Google Translate API key not configured, using simple translation',
        );
        return this.simpleTranslate(text);
      }

      const url = 'https://translation.googleapis.com/language/translate/v2';
      const response = await firstValueFrom(
        this.httpService.post(url, {
          q: text,
          target: 'ko',
          source: 'en',
          key: apiKey,
        }),
      );

      const translatedText =
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        (response.data?.data?.translations?.[0]?.translatedText as string) ||
        '';
      return translatedText || this.simpleTranslate(text);
    } catch (error) {
      this.logger.error(`Translation API error: ${(error as Error).message}`);
      return this.simpleTranslate(text);
    }
  }
}
