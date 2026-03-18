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

type DirectionKey =
  | 'u-turn'
  | 'left-turn'
  | 'right-turn'
  | 'keep-left'
  | 'keep-right'
  | 'continue'
  | 'arrival-start-station'
  | 'arrival-end-station'
  | 'arrival-destination'
  | 'arrival-waypoint'
  | 'roundabout';

/**
 * 방향 인스트럭션 매핑 (GraphHopper instruction → 한글 안내)
 * 순서 중요: 긴 패턴부터 매칭
 */
const DIRECTION_PATTERNS: ReadonlyArray<[RegExp, DirectionKey]> = [
  // U-turn
  [/Make a U-turn/i, 'u-turn'],
  // Sharp/Slight turns -> 단순화
  [/Turn sharp left/i, 'left-turn'],
  [/Turn sharp right/i, 'right-turn'],
  [/Turn slight left/i, 'keep-left'],
  [/Turn slight right/i, 'keep-right'],
  // Regular turns
  [/Turn left/i, 'left-turn'],
  [/Turn right/i, 'right-turn'],
  // Keep direction
  [/Keep left/i, 'keep-left'],
  [/Keep right/i, 'keep-right'],
  // Continue
  [/Continue/i, 'continue'],
  // Arrival
  [/Arrive at start station/i, 'arrival-start-station'],
  [/Arrive at end station/i, 'arrival-end-station'],
  [/Arrive at destination/i, 'arrival-destination'],
  [/Arrive at waypoint/i, 'arrival-waypoint'],
  // Roundabout
  [/Roundabout/i, 'roundabout'],
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
    const resolveDirectionText = (
      direction: DirectionKey,
      roadName?: string | null,
    ): string => {
      switch (direction) {
        case 'u-turn':
          return roadName ? `${roadName}에서 유턴입니다` : '유턴입니다';
        case 'left-turn':
          return roadName
            ? `${roadName} 방향으로 좌회전입니다`
            : '좌회전입니다';
        case 'right-turn':
          return roadName
            ? `${roadName} 방향으로 우회전입니다`
            : '우회전입니다';
        case 'keep-left':
          return roadName
            ? `${roadName} 방향으로 진행입니다`
            : '좌측으로 계속 진행입니다';
        case 'keep-right':
          return roadName
            ? `${roadName} 방향으로 진행입니다`
            : '우측으로 계속 진행입니다';
        case 'continue':
          return roadName ? `${roadName} 방향으로 직진입니다` : '직진입니다';
        case 'arrival-start-station':
          return '출발 대여소에 도착했습니다';
        case 'arrival-end-station':
          return '도착 대여소에 도착했습니다';
        case 'arrival-destination':
          return '목적지에 도착했습니다';
        case 'arrival-waypoint':
          return '경유지에 도착했습니다';
        case 'roundabout':
          return roadName ? `${roadName} 방향으로 진입입니다` : '로터리 진입입니다';
      }
    };

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
    let direction: DirectionKey | null = null;
    for (const [pattern, koreanDirection] of DIRECTION_PATTERNS) {
      if (pattern.test(text)) {
        direction = koreanDirection;
        break;
      }
    }

    // 4. 도로명과 방향 결합
    if (roadName && direction) {
      return resolveDirectionText(direction, roadName);
    }

    // 5. 도로명 없이 방향만
    if (direction) {
      return resolveDirectionText(direction);
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
