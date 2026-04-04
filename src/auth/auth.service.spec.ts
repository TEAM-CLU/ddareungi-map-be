import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { MailService } from '../mail/mail.service';
import { CryptoService } from '../common/crypto.service';
import { User } from '../user/entities/user.entity';
import { UserStats } from '../user/entities/user-stats.entity';

describe('AuthService social profile handling', () => {
  let service: AuthService;

  const userFindOneMock = jest.fn();
  const userCreateMock = jest.fn((input: Partial<User>) => ({ ...input }));
  const userSaveMock = jest.fn(async (user: Partial<User>) => {
    if (!user.userId) {
      user.userId = 101;
    }
    return user;
  });

  const userRepository = {
    findOne: userFindOneMock,
    create: userCreateMock,
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

  const mailService = {} as MailService;
  const configService = {
    get: jest.fn(),
    getOrThrow: jest.fn(),
  } as unknown as ConfigService;
  const jwtService = {
    sign: jest.fn().mockReturnValue('jwt-token'),
  } as unknown as JwtService;
  const cryptoService = {} as CryptoService;
  const redisMultiExecMock = jest.fn().mockResolvedValue([]);
  const redisMultiMock = jest.fn(() => ({
    setex: jest.fn().mockReturnThis(),
    exec: redisMultiExecMock,
  }));
  const redis = {
    multi: redisMultiMock,
  };
  const redisService = {
    getOrThrow: jest.fn(),
  } as unknown as RedisService;

  beforeEach(() => {
    userFindOneMock.mockReset();
    userCreateMock.mockReset();
    userCreateMock.mockImplementation((input: Partial<User>) => ({ ...input }));
    userSaveMock.mockReset();
    userSaveMock.mockImplementation(async (user: Partial<User>) => {
      if (!user.userId) {
        user.userId = 101;
      }
      return user;
    });
    ensureUserStatsExecuteMock.mockReset();
    ensureUserStatsExecuteMock.mockResolvedValue(undefined);
    (configService.get as jest.Mock).mockReset();
    (configService.getOrThrow as jest.Mock).mockReset();
    (jwtService.sign as jest.Mock).mockReset();
    (jwtService.sign as jest.Mock).mockReturnValue('jwt-token');
    redisMultiExecMock.mockReset();
    redisMultiExecMock.mockResolvedValue([]);
    redisMultiMock.mockClear();
    (redisService.getOrThrow as jest.Mock).mockReset();
    (redisService.getOrThrow as jest.Mock).mockReturnValue(redis);
    service = new AuthService(
      mailService,
      configService,
      jwtService,
      cryptoService,
      redisService,
      userRepository,
      userStatsRepository,
    );
  });

  it('stores Kakao nickname from kakao_account.profile on signup', async () => {
    userFindOneMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await service.handleKakaoLogin({
      id: 12345,
      kakao_account: {
        email: 'kakao@example.com',
        email_needs_agreement: false,
        profile: {
          nickname: '카카오닉네임',
        },
      },
    });

    expect(userCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        socialName: 'Kakao',
        socialUid: '12345',
        email: 'kakao@example.com',
        name: '카카오닉네임',
        requiredAgreed: true,
        optionalAgreed: true,
      }),
    );
  });

  it('requests Kakao profile_nickname scope for PKCE login', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'KAKAO_CLIENT_ID') return 'kakao-client-id';
      if (key === 'KAKAO_PKCE_CALLBACK_URL') {
        return 'https://example.com/auth/kakao/pkce/callback';
      }
      return undefined;
    });

    const result = await service.getKakaoPKCEAuthUrl();
    const url = new URL(result.authUrl);

    expect(url.searchParams.get('scope')).toContain('profile_nickname');
    expect(url.searchParams.get('scope')).not.toContain(' name ');
  });

  it('falls back to placeholder and keeps optionalAgreed false when Kakao optional fields are missing', async () => {
    userFindOneMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await service.handleKakaoLogin({
      id: 12345,
      kakao_account: {
        email: 'kakao@example.com',
        email_needs_agreement: true,
        profile_needs_agreement: true,
      },
    });

    expect(userCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Kakao User',
        requiredAgreed: true,
        optionalAgreed: false,
      }),
    );
  });

  it('backfills Kakao placeholder name and promotes consent flags for existing users only', async () => {
    userFindOneMock.mockResolvedValue({
      userId: 1,
      email: 'kakao@example.com',
      name: 'Kakao User',
      gender: null,
      birthYear: null,
      requiredAgreed: false,
      optionalAgreed: false,
      socialName: 'Kakao',
      socialUid: '12345',
    });

    await service.handleKakaoLogin({
      id: 12345,
      kakao_account: {
        email: 'kakao@example.com',
        email_needs_agreement: false,
        gender: 'male',
        birthyear: '1999',
        profile: {
          nickname: '새카카오닉네임',
        },
      },
    });

    expect(userSaveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '새카카오닉네임',
        gender: 'M',
        birthYear: '1999',
        requiredAgreed: true,
        optionalAgreed: true,
      }),
    );
  });

  it('does not overwrite a custom Naver name during login but promotes consent flags', async () => {
    userFindOneMock.mockResolvedValue({
      userId: 2,
      email: 'naver@example.com',
      name: '사용자수정이름',
      gender: null,
      birthYear: null,
      requiredAgreed: false,
      optionalAgreed: false,
      socialName: 'Naver',
      socialUid: 'abc',
    });

    await service.handleNaverLogin({
      response: {
        id: 'abc',
        email: 'naver@example.com',
        nickname: '네이버닉네임',
        gender: 'F',
        birthyear: '2001',
      },
    });

    expect(userSaveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '사용자수정이름',
        gender: 'F',
        birthYear: '2001',
        requiredAgreed: true,
        optionalAgreed: true,
      }),
    );
  });

  it('backfills Naver placeholder name with nickname for existing users', async () => {
    userFindOneMock.mockResolvedValue({
      userId: 3,
      email: 'naver@example.com',
      name: 'Naver User',
      gender: null,
      birthYear: null,
      requiredAgreed: true,
      optionalAgreed: false,
      socialName: 'Naver',
      socialUid: 'naver-1',
    });

    await service.handleNaverLogin({
      response: {
        id: 'naver-1',
        email: 'naver@example.com',
        nickname: '네이버닉네임',
      },
    });

    expect(userSaveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '네이버닉네임',
        requiredAgreed: true,
        optionalAgreed: true,
      }),
    );
  });

  it('stores Naver consent flags conservatively on signup', async () => {
    userFindOneMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await service.handleNaverLogin({
      response: {
        id: 'naver-2',
      },
    });

    expect(userCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        socialName: 'Naver',
        socialUid: 'naver-2',
        requiredAgreed: true,
        optionalAgreed: false,
      }),
    );
  });

  it('does not downgrade optionalAgreed when current Naver response has no optional fields', async () => {
    userFindOneMock.mockResolvedValue({
      userId: 4,
      email: 'naver@example.com',
      name: '기존이름',
      gender: 'F',
      birthYear: '2000',
      requiredAgreed: true,
      optionalAgreed: true,
      socialName: 'Naver',
      socialUid: 'naver-3',
    });

    await service.handleNaverLogin({
      response: {
        id: 'naver-3',
      },
    });

    expect(userSaveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        optionalAgreed: true,
      }),
    );
  });
});
