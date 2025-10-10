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
  SeoulBikeRealtimeApiResponse,
  SeoulBikeRealtimeInfo,
} from '../dto/station.dto';

@Injectable()
export class SeoulApiService {
  private readonly logger = new Logger(SeoulApiService.name);

  // API 상수
  private readonly baseUrl = 'http://openapi.seoul.go.kr:8088';
  private readonly serviceName = 'tbCycleStationInfo';
  private readonly realtimeServiceName = 'bikeList';

  // 설정 상수
  private readonly defaultPageSize = 1000;
  private readonly maxRetries = 3;
  private readonly apiDelay = 100; // 기본 API 호출 간격 (ms)
  private readonly realtimeApiDelay = 500; // 실시간 API 호출 간격 (ms)
  private readonly requestTimeout = 10000; // API 요청 타임아웃 (ms)

  // API 응답 코드
  private readonly successCode = 'INFO-000';

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
   * API URL 생성 (재사용 가능한 범용 메서드)
   */
  private buildApiUrl(
    serviceName: string,
    startIndex: number,
    endIndex: number,
    additionalPath?: string,
  ): string {
    const apiKey = this.getApiKey();
    const path = additionalPath ? `/${additionalPath}` : '';
    return `${this.baseUrl}/${apiKey}/json/${serviceName}/${startIndex}/${endIndex}${path}`;
  }

  /**
   * 대여소 정보 API URL 생성
   */
  private buildStationApiUrl(startIndex: number, endIndex: number): string {
    return this.buildApiUrl(this.serviceName, startIndex, endIndex);
  }

  /**
   * 실시간 대여 정보 API URL 생성
   */
  private buildRealtimeApiUrl(stationId: string): string {
    return this.buildApiUrl(this.realtimeServiceName, 1, 1, `/${stationId}`);
  }

  /**
   * 지연 유틸리티 (재사용 가능)
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    endIndex: number = this.defaultPageSize,
  ): Promise<SeoulBikeStationApiResponse> {
    const url = this.buildStationApiUrl(startIndex, endIndex);
    return this.executeApiRequest(url);
  }

  /**
   * 모든 대여소 정보를 페이지네이션으로 조회
   * 재시도 로직과 개선된 오류 처리 포함
   */
  async fetchAllStations(): Promise<SeoulBikeStationInfo[]> {
    const allStations: SeoulBikeStationInfo[] = [];
    let currentPage = 1;
    let hasMoreData = true;

    this.logger.log('모든 대여소 정보 조회 시작');

    while (hasMoreData) {
      const startIndex = (currentPage - 1) * this.defaultPageSize + 1;
      const endIndex = currentPage * this.defaultPageSize;

      this.logger.log(
        `페이지 ${currentPage} 조회 중... (${startIndex}-${endIndex})`,
      );

      const response = await this.fetchStationInfoWithRetry(
        startIndex,
        endIndex,
      );

      if (response?.row && response.row.length > 0) {
        allStations.push(...response.row);

        // 반환된 데이터가 pageSize보다 적으면 마지막 페이지
        if (response.row.length < this.defaultPageSize) {
          hasMoreData = false;
        } else {
          currentPage++;
        }
      } else {
        hasMoreData = false;
      }

      // API 호출 간격 조절
      await this.delay(this.apiDelay);
    }

    this.logger.log(`전체 대여소 조회 완료: 총 ${allStations.length}개 대여소`);
    return allStations;
  }

  /**
   * 재시도 로직이 포함된 대여소 정보 조회
   */
  private async fetchStationInfoWithRetry(
    startIndex: number,
    endIndex: number,
  ): Promise<SeoulBikeStationApiResponse | null> {
    let attempts = 0;

    while (attempts < this.maxRetries) {
      try {
        attempts++;
        return await this.fetchStationInfo(startIndex, endIndex);
      } catch (error) {
        this.logger.warn(
          `페이지 조회 실패 (시도 ${attempts}/${this.maxRetries}):`,
          error,
        );

        if (attempts >= this.maxRetries) {
          this.logger.error('최대 재시도 횟수 초과, 조회 중단');
          return null;
        }

        // 재시도 전 대기 (점진적 증가)
        await this.delay(1000 * attempts);
      }
    }

    return null;
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

  /**
   * 특정 대여소의 실시간 대여 정보 조회
   */
  async fetchRealtimeStationInfo(
    stationId: string,
  ): Promise<SeoulBikeRealtimeInfo | null> {
    try {
      const url = this.buildRealtimeApiUrl(stationId);
      this.logger.debug(`실시간 대여 정보 API 호출: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get<SeoulBikeRealtimeApiResponse>(url, {
          timeout: this.requestTimeout,
        }),
      );

      return this.parseRealtimeApiResponse(response.data, stationId);
    } catch (error) {
      this.logger.error(`실시간 대여 정보 조회 실패 - ${stationId}:`, error);
      return null; // 실시간 정보 조회 실패는 치명적이지 않음
    }
  }

  /**
   * 실시간 API 응답 파싱
   */
  private parseRealtimeApiResponse(
    data: SeoulBikeRealtimeApiResponse,
    stationId: string,
  ): SeoulBikeRealtimeInfo | null {
    // 응답 상태 확인
    if (!data?.rentBikeStatus) {
      this.logger.warn(`실시간 대여 정보 응답 형식 오류: ${stationId}`);
      return null;
    }

    const { rentBikeStatus } = data;

    // API 결과 코드 확인
    if (rentBikeStatus.RESULT?.CODE !== this.successCode) {
      this.logger.warn(
        `실시간 대여 정보 API 오류 - ${stationId}: ${rentBikeStatus.RESULT?.MESSAGE}`,
      );
      return null;
    }

    // 데이터 존재 확인
    if (!rentBikeStatus.row || rentBikeStatus.row.length === 0) {
      this.logger.warn(`실시간 대여 정보 없음: ${stationId}`);
      return null;
    }

    const realtimeInfo = rentBikeStatus.row[0];
    this.logger.debug(
      `실시간 대여 정보 조회 성공 - ${stationId}: 거치대 ${realtimeInfo.rackTotCnt}, 주차 ${realtimeInfo.parkingBikeTotCnt}`,
    );

    return realtimeInfo;
  }

  /**
   * 여러 대여소의 실시간 대여 정보 일괄 조회
   */
  async fetchMultipleRealtimeStationInfo(
    stationIds: string[],
  ): Promise<Map<string, SeoulBikeRealtimeInfo>> {
    const realtimeInfoMap = new Map<string, SeoulBikeRealtimeInfo>();

    this.logger.log(`${stationIds.length}개 대여소 실시간 정보 조회 시작`);

    // 순차 처리로 API 호출 제한 준수
    for (const stationId of stationIds) {
      try {
        const realtimeInfo = await this.fetchRealtimeStationInfo(stationId);
        if (realtimeInfo) {
          realtimeInfoMap.set(stationId, realtimeInfo);
        }

        // API 호출 간격 조절
        await this.delay(this.realtimeApiDelay);
      } catch (error) {
        this.logger.warn(
          `실시간 정보 조회 실패 (계속 진행): ${stationId}`,
          error,
        );
        continue;
      }
    }

    this.logger.log(
      `실시간 정보 조회 완료: ${realtimeInfoMap.size}/${stationIds.length}개 성공`,
    );

    return realtimeInfoMap;
  }
}
