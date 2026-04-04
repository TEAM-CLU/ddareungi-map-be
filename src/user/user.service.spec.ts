import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { UserStats } from './entities/user-stats.entity';

describe('UserService', () => {
  let service: UserService;

  const userFindOneMock = jest.fn();
  const userSaveMock = jest.fn(async (user: Partial<User>) => {
    if (!user.userId) {
      user.userId = 1;
    }
    return user;
  });

  const userRepository = {
    findOne: userFindOneMock,
    save: userSaveMock,
  } as unknown as Repository<User>;

  const ensureUserStatsExecuteMock = jest.fn().mockResolvedValue(undefined);
  const userStatsRepository = {
    createQueryBuilder: jest.fn(() => ({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: ensureUserStatsExecuteMock,
    })),
  } as unknown as Repository<UserStats>;

  const jwtService = {
    sign: jest.fn(),
  } as unknown as JwtService;

  beforeEach(() => {
    userFindOneMock.mockReset();
    userSaveMock.mockReset();
    userSaveMock.mockImplementation(async (user: Partial<User>) => {
      if (!user.userId) {
        user.userId = 1;
      }
      return user;
    });
    ensureUserStatsExecuteMock.mockReset();
    ensureUserStatsExecuteMock.mockResolvedValue(undefined);

    service = new UserService(userRepository, userStatsRepository, jwtService);
  });

  it('stores 자체회원가입 in socialName for local registration only', async () => {
    userFindOneMock.mockResolvedValue(null);

    await service.register({
      email: 'local@example.com',
      password: 'password123',
      name: '로컬회원',
      requiredAgreed: true,
      optionalAgreed: false,
    });

    expect(userSaveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'local@example.com',
        name: '로컬회원',
        socialName: '자체회원가입',
        socialUid: null,
        passwordHash: expect.any(String),
      }),
    );
  });
});
