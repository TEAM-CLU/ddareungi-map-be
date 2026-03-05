import { IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 키워드 검색 DTO
 * GET /locations/keyword
 */
export class KeywordSearchDto {
  @ApiProperty({
    description: '검색 키워드',
    example: '카카오프렌즈',
  })
  @IsString({ message: '검색 키워드는 문자열이어야 합니다.' })
  query: string;

  @ApiProperty({
    description: '페이지 번호 (기본값: 1)',
    example: 1,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiProperty({
    description: '한 페이지에 보여질 문서 개수 (기본값: 15, 최대: 45)',
    example: 15,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(45)
  size?: number;

  @ApiProperty({
    description: '정렬 방식 (accuracy: 정확도순, distance: 거리순)',
    example: 'accuracy',
    required: false,
  })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiProperty({
    description: '중심 좌표의 경도 (거리순 정렬 시 필수)',
    example: 127.027619,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  x?: number;

  @ApiProperty({
    description: '중심 좌표의 위도 (거리순 정렬 시 필수)',
    example: 37.497942,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  y?: number;

  @ApiProperty({
    description: '검색 반경 (미터 단위, 0~20000)',
    example: 5000,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(20000)
  radius?: number;
}

/**
 * 주소 검색 DTO
 * GET /locations/address
 */
export class AddressSearchDto {
  @ApiProperty({
    description: '검색할 주소',
    example: '서울특별시 강남구 역삼동',
  })
  @IsString({ message: '주소는 문자열이어야 합니다.' })
  query: string;

  @ApiProperty({
    description: '페이지 번호 (기본값: 1)',
    example: 1,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiProperty({
    description: '한 페이지에 보여질 문서 개수 (기본값: 10, 최대: 30)',
    example: 10,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(30)
  size?: number;
}

/**
 * 역지오코딩 (좌표 → 주소) DTO
 * GET /locations/coord2address
 */
export class ReverseGeocodeDto {
  @ApiProperty({
    description: '경도',
    example: 127.027619,
  })
  @Type(() => Number)
  @IsNumber({}, { message: '경도는 숫자여야 합니다.' })
  x: number;

  @ApiProperty({
    description: '위도',
    example: 37.497942,
  })
  @Type(() => Number)
  @IsNumber({}, { message: '위도는 숫자여야 합니다.' })
  y: number;

  @ApiProperty({
    description: '입력 좌표 체계 (WGS84, WCONGNAMUL, CONGNAMUL, WTM, TM)',
    example: 'WGS84',
    required: false,
  })
  @IsOptional()
  @IsString()
  input_coord?: string;
}

/**
 * 카카오 API 응답 DTO
 */
export class KakaoApiResponseDto {
  meta: {
    total_count: number;
    pageable_count: number;
    is_end: boolean;
  };
  documents: any[];
}
