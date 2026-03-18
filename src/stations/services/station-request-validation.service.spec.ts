import { BadRequestException } from '@nestjs/common';
import { StationRequestValidationService } from './station-request-validation.service';

describe('StationRequestValidationService', () => {
  let service: StationRequestValidationService;

  beforeEach(() => {
    service = new StationRequestValidationService();
  });

  it('parses valid coordinates and radius', () => {
    expect(
      service.validateCoordinatesWithRadius('37.63', '127.07', '1000'),
    ).toEqual({
      latitude: 37.63,
      longitude: 127.07,
      radius: 1000,
    });
  });

  it('throws BadRequestException for invalid coordinate pair', () => {
    expect(() => service.validateCoordinates('bad', '127.07')).toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when only one optional coordinate is provided', () => {
    expect(() => service.validateOptionalCoordinates('37.63', undefined)).toThrow(
      BadRequestException,
    );
  });
});
