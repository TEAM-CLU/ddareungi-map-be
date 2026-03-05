import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  KeywordSearchDto,
  AddressSearchDto,
  ReverseGeocodeDto,
  KakaoApiResponseDto,
} from './dto/location.dto';

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);
  private readonly kakaoBaseUrl = 'https://dapi.kakao.com/v2/local';
  private readonly kakaoApiKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.kakaoApiKey = this.configService.getOrThrow<string>('KAKAO_CLIENT_ID');
  }

  /**
   * 키워드로 장소 검색
   * GET /v2/local/search/keyword.json
   */
  async searchKeyword(dto: KeywordSearchDto): Promise<KakaoApiResponseDto> {
    const url = `${this.kakaoBaseUrl}/search/keyword.json`;

    try {
      const response = await firstValueFrom(
        this.httpService.get<KakaoApiResponseDto>(url, {
          params: {
            query: dto.query,
            ...(dto.page && { page: dto.page }),
            ...(dto.size && { size: dto.size }),
            ...(dto.sort && { sort: dto.sort }),
            ...(dto.x && { x: dto.x }),
            ...(dto.y && { y: dto.y }),
            ...(dto.radius && { radius: dto.radius }),
          },
          headers: {
            Authorization: `KakaoAK ${this.kakaoApiKey}`,
          },
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error({
        message: '[Kakao API] 키워드 검색 실패',
        query: dto.query,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) },
      });
      throw error;
    }
  }

  /**
   * 주소로 좌표 검색
   * GET /v2/local/search/address.json
   */
  async searchAddress(dto: AddressSearchDto): Promise<KakaoApiResponseDto> {
    const url = `${this.kakaoBaseUrl}/search/address.json`;

    try {
      const response = await firstValueFrom(
        this.httpService.get<KakaoApiResponseDto>(url, {
          params: {
            query: dto.query,
            ...(dto.page && { page: dto.page }),
            ...(dto.size && { size: dto.size }),
          },
          headers: {
            Authorization: `KakaoAK ${this.kakaoApiKey}`,
          },
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error({
        message: '[Kakao API] 주소 검색 실패',
        query: dto.query,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) },
      });
      throw error;
    }
  }

  /**
   * 좌표로 주소 검색 (역지오코딩)
   * GET /v2/local/geo/coord2address.json
   */
  async reverseGeocode(dto: ReverseGeocodeDto): Promise<KakaoApiResponseDto> {
    const url = `${this.kakaoBaseUrl}/geo/coord2address.json`;

    try {
      const response = await firstValueFrom(
        this.httpService.get<KakaoApiResponseDto>(url, {
          params: {
            x: dto.x,
            y: dto.y,
            ...(dto.input_coord && { input_coord: dto.input_coord }),
          },
          headers: {
            Authorization: `KakaoAK ${this.kakaoApiKey}`,
          },
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error({
        message: '[Kakao API] 역지오코딩 실패',
        x: dto.x,
        y: dto.y,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) },
      });
      throw error;
    }
  }
}
