import { BadRequestException } from '@nestjs/common';
import { RouteUtilService } from './route-util.service';

describe('RouteUtilService', () => {
  let service: RouteUtilService;

  beforeEach(() => {
    service = new RouteUtilService();
  });

  it('accepts valid coordinates', () => {
    expect(() =>
      service.validateCoordinate({ lat: 37.63, lng: 127.07 }, '출발지'),
    ).not.toThrow();
  });

  it('throws BadRequestException for invalid latitude', () => {
    expect(() =>
      service.validateCoordinate({ lat: 91, lng: 127.07 }, '출발지'),
    ).toThrow(BadRequestException);
  });
});
