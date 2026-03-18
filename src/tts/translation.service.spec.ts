import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { TranslationService } from './translation.service';

describe('TranslationService', () => {
  let service: TranslationService;

  beforeEach(() => {
    service = new TranslationService(
      {} as ConfigService,
      {} as HttpService,
    );
  });

  it('translates road turns using 방향으로 phrasing', () => {
    expect(service.translateToKorean('Turn right onto 압구정 나들목로')).toBe(
      '압구정 나들목로 방향으로 우회전입니다',
    );
    expect(service.translateToKorean('Turn left onto 공릉로51길')).toBe(
      '공릉로51길 방향으로 좌회전입니다',
    );
    expect(
      service.translateToKorean('Turn sharp right onto 올림픽대로'),
    ).toBe('올림픽대로 방향으로 우회전입니다');
  });

  it('translates continue instructions using 방향으로 phrasing when road name exists', () => {
    expect(
      service.translateToKorean('Continue onto 중랑천 자전거길 출입로'),
    ).toBe('중랑천 자전거길 출입로 방향으로 직진입니다');
  });

  it('keeps no-road keep-left/right instructions concise', () => {
    expect(service.translateToKorean('Keep left')).toBe(
      '좌측으로 계속 진행입니다',
    );
    expect(service.translateToKorean('Keep right')).toBe(
      '우측으로 계속 진행입니다',
    );
  });

  it('simplifies slight and keep instructions with road names to 진행입니다', () => {
    expect(
      service.translateToKorean('Turn slight left onto 압구정 나들목로'),
    ).toBe('압구정 나들목로 방향으로 진행입니다');
    expect(
      service.translateToKorean('Keep right onto 공릉로51길'),
    ).toBe('공릉로51길 방향으로 진행입니다');
  });

  it('preserves arrival instructions', () => {
    expect(service.translateToKorean('Arrive at destination')).toBe(
      '목적지에 도착했습니다',
    );
    expect(service.translateToKorean('Arrive at end station')).toBe(
      '도착 대여소에 도착했습니다',
    );
  });
});
