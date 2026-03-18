import {
  Controller,
  Get,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { LocationService } from './location.service';
import {
  SuccessResponseDto,
  ErrorResponseDto,
} from '../common/api-response.dto';
import {
  KeywordSearchDto,
  AddressSearchDto,
  ReverseGeocodeDto,
  KakaoApiResponseDto,
} from './dto/location.dto';

@ApiTags('장소검색 (Location)')
@Controller('locations')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  /**
   * 키워드로 장소 검색
   * GET /locations/keyword
   */
  @Get('keyword')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '키워드로 장소 검색',
    description:
      '카카오 Local API의 키워드 장소 검색을 프록시합니다. 쿼리 파라미터를 그대로 카카오 API에 전달합니다.',
  })
  @ApiQuery({
    name: 'query',
    required: true,
    description: '검색 키워드',
    example: '카카오프렌즈',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: '페이지 번호 (기본값: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'size',
    required: false,
    description: '한 페이지에 보여질 문서 개수 (기본값: 15, 최대: 45)',
    example: 15,
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    description: '정렬 방식 (accuracy: 정확도순, distance: 거리순)',
    example: 'accuracy',
  })
  @ApiQuery({
    name: 'x',
    required: false,
    description: '중심 좌표의 경도 (거리순 정렬 시 필수)',
  })
  @ApiQuery({
    name: 'y',
    required: false,
    description: '중심 좌표의 위도 (거리순 정렬 시 필수)',
  })
  @ApiQuery({
    name: 'radius',
    required: false,
    description: '검색 반경 (미터 단위, 0~20000)',
  })
  @ApiResponse({
    status: 200,
    description: '카카오 API 응답을 그대로 반환',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 파라미터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '카카오 API 호출 실패',
    type: ErrorResponseDto,
  })
  async searchKeyword(
    @Query() dto: KeywordSearchDto,
  ): Promise<SuccessResponseDto<KakaoApiResponseDto>> {
    const result = await this.locationService.searchKeyword(dto);
    return SuccessResponseDto.create(
      '키워드 검색이 성공적으로 완료되었습니다.',
      result,
    );
  }

  /**
   * 주소로 좌표 검색
   * GET /locations/address
   */
  @Get('address')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '주소로 좌표 검색',
    description:
      '카카오 Local API의 주소 검색을 프록시합니다. 주소를 입력하면 해당 위치의 좌표를 반환합니다.',
  })
  @ApiQuery({
    name: 'query',
    required: true,
    description: '검색할 주소',
    example: '서울특별시 강남구 역삼동',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: '페이지 번호 (기본값: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'size',
    required: false,
    description: '한 페이지에 보여질 문서 개수 (기본값: 10, 최대: 30)',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: '카카오 API 응답을 그대로 반환',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 파라미터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '카카오 API 호출 실패',
    type: ErrorResponseDto,
  })
  async searchAddress(
    @Query() dto: AddressSearchDto,
  ): Promise<SuccessResponseDto<KakaoApiResponseDto>> {
    const result = await this.locationService.searchAddress(dto);
    return SuccessResponseDto.create(
      '주소 검색이 성공적으로 완료되었습니다.',
      result,
    );
  }

  /**
   * 좌표로 주소 검색 (역지오코딩)
   * GET /locations/coord2address
   */
  @Get('coord2address')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '좌표로 주소 검색 (역지오코딩)',
    description:
      '카카오 Local API의 역지오코딩을 프록시합니다. 좌표를 입력하면 해당 위치의 주소를 반환합니다.',
  })
  @ApiQuery({
    name: 'x',
    required: true,
    description: '경도',
    example: 127.027619,
  })
  @ApiQuery({
    name: 'y',
    required: true,
    description: '위도',
    example: 37.497942,
  })
  @ApiQuery({
    name: 'input_coord',
    required: false,
    description: '입력 좌표 체계 (WGS84, WCONGNAMUL, CONGNAMUL, WTM, TM)',
    example: 'WGS84',
  })
  @ApiResponse({
    status: 200,
    description: '카카오 API 응답을 그대로 반환',
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 파라미터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '카카오 API 호출 실패',
    type: ErrorResponseDto,
  })
  async reverseGeocode(
    @Query() dto: ReverseGeocodeDto,
  ): Promise<SuccessResponseDto<KakaoApiResponseDto>> {
    const result = await this.locationService.reverseGeocode(dto);
    return SuccessResponseDto.create(
      '역지오코딩이 성공적으로 완료되었습니다.',
      result,
    );
  }
}
