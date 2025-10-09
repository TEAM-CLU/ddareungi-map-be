import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  SeoulBikeStationApiResponse,
  SeoulBikeStationInfo,
  SeoulApiWrapperResponse,
  SeoulApiResponse,
  isSeoulApiSuccessResponse,
  isSeoulApiResultSuccess,
} from '../dto/station.dto';

@Injectable()
export class SeoulApiService {
  private readonly logger = new Logger(SeoulApiService.name);
  private readonly baseUrl = 'http://openapi.seoul.go.kr:8088';
  private readonly serviceName = 'tbCycleStationInfo';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * API 키 검증 및 가져오기
   */
  private getApiKey(): string {
    const apiKey = this.configService.get<string>('SEOUL_OPEN_API_KEY');

    if (!apiKey) {
      throw new Error(
        '서울시 OpenAPI 키가 설정되지 않았습니다. SEOUL_OPEN_API_KEY 환경변수를 확인해주세요.',
      );
    }

    return apiKey;
  }

  /**
   * API URL 생성
   */
  private buildApiUrl(startIndex: number, endIndex: number): string {
    const apiKey = this.getApiKey();
    return `${this.baseUrl}/${apiKey}/json/${this.serviceName}/${startIndex}/${endIndex}/`;
  }

  /**
   * 서울시 API 응답 검증 및 파싱
   */
  private parseSeoulApiResponse(
    responseData: unknown,
  ): SeoulBikeStationApiResponse {
    if (!responseData || typeof responseData !== 'object') {
      throw new Error('서울시 API 응답이 비어있거나 유효하지 않습니다.');
    }

    const typedResponse =
      responseData as SeoulApiWrapperResponse<SeoulBikeStationInfo>;

    // stationInfo 키로 래핑된 응답 처리
    let data: SeoulApiResponse<SeoulBikeStationInfo>;
    if (typedResponse.stationInfo) {
      data = typedResponse.stationInfo;
    } else if (typedResponse.RESULT) {
      // 직접 오류 응답인 경우
      throw new Error(
        `서울시 API 오류: ${typedResponse.RESULT.MESSAGE || typedResponse.RESULT.CODE}`,
      );
    } else {
      // 예상과 다른 응답 구조
      this.logger.error('예상과 다른 API 응답 구조:', responseData);
      throw new Error('서울시 API 응답 구조를 파싱할 수 없습니다.');
    }

    // 성공 응답인지 확인
    if (!isSeoulApiSuccessResponse(data)) {
      throw new Error('서울시 API에서 오류 응답을 받았습니다.');
    }

    // API 응답 결과 코드 확인
    if (!isSeoulApiResultSuccess(data.RESULT)) {
      throw new Error(
        `서울시 API 오류: ${data.RESULT.MESSAGE || '알 수 없는 오류'}`,
      );
    }

    return data;
  }

  /**
   * HTTP 요청 실행 (재사용 가능한 메서드)
   */
  private async executeApiRequest(
    url: string,
  ): Promise<SeoulBikeStationApiResponse> {
    try {
      this.logger.log(`서울시 API 호출: ${url}`);

      const response = await firstValueFrom(this.httpService.get(url));

      this.logger.debug(
        '서울시 API 원시 응답:',
        JSON.stringify(response.data, null, 2),
      );

      const parsedData = this.parseSeoulApiResponse(response.data);

      this.logger.log(
        `서울시 API 응답 성공: 총 ${parsedData.list_total_count || 0}건 중 ${
          parsedData.row?.length || 0
        }건 조회`,
      );

      return parsedData;
    } catch (error) {
      this.logger.error('서울시 API 호출 실패:', error);
      throw error;
    }
  }

  /**
   * 서울시 공공자전거 대여소 정보 조회
   */
  async fetchStationInfo(
    startIndex: number = 1,
    endIndex: number = 1000,
  ): Promise<SeoulBikeStationApiResponse> {
    const url = this.buildApiUrl(startIndex, endIndex);
    return this.executeApiRequest(url);
  }

  /**
   * 모든 대여소 정보를 페이지네이션으로 조회
   * 재시도 로직과 개선된 오류 처리 포함
   */
  async fetchAllStations(): Promise<SeoulBikeStationInfo[]> {
    const allStations: SeoulBikeStationInfo[] = [];
    const pageSize = 1000; // 한 번에 가져올 개수
    const maxRetries = 3; // 재시도 횟수
    let currentPage = 1;
    let hasMoreData = true;

    this.logger.log('모든 대여소 정보 조회 시작');

    while (hasMoreData) {
      const startIndex = (currentPage - 1) * pageSize + 1;
      const endIndex = currentPage * pageSize;

      this.logger.log(
        `페이지 ${currentPage} 조회 중... (${startIndex}-${endIndex})`,
      );

      let attempts = 0;
      let success = false;

      while (attempts < maxRetries && !success) {
        try {
          attempts++;

          const response = await this.fetchStationInfo(startIndex, endIndex);

          if (response.row && response.row.length > 0) {
            allStations.push(...response.row);

            // 반환된 데이터가 pageSize보다 적으면 마지막 페이지
            if (response.row.length < pageSize) {
              hasMoreData = false;
            } else {
              currentPage++;
            }
          } else {
            hasMoreData = false;
          }

          success = true;

          // API 호출 간격 조절 (너무 빈번한 호출 방지)
          await this.delay(100);
        } catch (error) {
          this.logger.warn(
            `페이지 ${currentPage} 조회 실패 (시도 ${attempts}/${maxRetries}):`,
            error,
          );

          if (attempts >= maxRetries) {
            this.logger.error(
              `페이지 ${currentPage} 최대 재시도 횟수 초과, 조회 중단`,
            );
            hasMoreData = false;
          } else {
            // 재시도 전 잠시 대기
            await this.delay(1000 * attempts);
          }
        }
      }
    }

    this.logger.log(`전체 대여소 조회 완료: 총 ${allStations.length}개 대여소`);
    return allStations;
  }

  /**
   * 특정 대여소 ID로 조회 (개선된 버전)
   */
  async fetchStationById(
    stationId: string,
  ): Promise<SeoulBikeStationInfo | null> {
    try {
      // 캐시나 더 효율적인 방법이 있다면 여기서 사용
      // 현재는 전체 조회 후 필터링 (향후 개선 가능)
      const allStations = await this.fetchAllStations();
      return (
        allStations.find((station) => station.RENT_ID === stationId) || null
      );
    } catch (error) {
      this.logger.error(`대여소 ID ${stationId} 조회 실패:`, error);
      throw error;
    }
  }

  /**
   * 지연 유틸리티 (재사용 가능)
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * API 상태 확인 (헬스체크)
   */
  async checkApiHealth(): Promise<boolean> {
    try {
      // 최소한의 데이터로 API 상태 확인
      await this.fetchStationInfo(1, 1);
      return true;
    } catch (error) {
      this.logger.error('서울시 API 상태 확인 실패:', error);
      return false;
    }
  }
}
