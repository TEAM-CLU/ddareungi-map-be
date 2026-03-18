import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class StationRequestValidationService {
  validateCoordinates(
    latitude: number | string,
    longitude: number | string,
  ): { latitude: number; longitude: number } {
    const validated = this.parseCoordinates(latitude, longitude, {
      invalidMessage: '유효하지 않은 위도/경도 값입니다.',
    });

    this.assertCoordinateRange(validated.latitude, validated.longitude);

    return validated;
  }

  validateCoordinatesWithRadius(
    latitude: number | string,
    longitude: number | string,
    radius: number | string,
  ): { latitude: number; longitude: number; radius: number } {
    const validated = this.validateCoordinates(latitude, longitude);
    const parsedRadius = Number(radius);

    if (Number.isNaN(parsedRadius)) {
      throw new BadRequestException('유효하지 않은 위도/경도/반경 값입니다.');
    }

    if (parsedRadius < 100 || parsedRadius > 20000) {
      throw new BadRequestException('반경은 100m~20km 범위여야 합니다.');
    }

    return {
      ...validated,
      radius: parsedRadius,
    };
  }

  validateOptionalCoordinates(
    latitude?: number | string,
    longitude?: number | string,
  ): { latitude?: number; longitude?: number } {
    const hasLatitude = latitude !== undefined;
    const hasLongitude = longitude !== undefined;

    if (!hasLatitude && !hasLongitude) {
      return {};
    }

    if (!hasLatitude || !hasLongitude) {
      throw new BadRequestException(
        '위치 기반 거리 계산에는 위도와 경도를 모두 전달해야 합니다.',
      );
    }

    return this.validateCoordinates(latitude, longitude);
  }

  private parseCoordinates(
    latitude: number | string,
    longitude: number | string,
    messages: { invalidMessage: string },
  ): { latitude: number; longitude: number } {
    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);

    if (Number.isNaN(parsedLatitude) || Number.isNaN(parsedLongitude)) {
      throw new BadRequestException(messages.invalidMessage);
    }

    return {
      latitude: parsedLatitude,
      longitude: parsedLongitude,
    };
  }

  private assertCoordinateRange(latitude: number, longitude: number): void {
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new BadRequestException(
        '위도는 -90~90, 경도는 -180~180 범위여야 합니다.',
      );
    }
  }
}
