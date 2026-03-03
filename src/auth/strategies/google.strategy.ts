import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import axios from 'axios';

type GooglePeopleApiResponse = {
  genders?: Array<{ value?: string }>;
  birthdays?: Array<{ date?: { year?: number; month?: number; day?: number } }>;
};

@Injectable()
export class JwtGoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const options = {
      clientID: configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: [
        'email',
        'profile',
        'https://www.googleapis.com/auth/user.gender.read',
        'https://www.googleapis.com/auth/user.birthday.read',
        'https://www.googleapis.com/auth/user.phonenumbers.read',
      ],
    };

    super(options);
  }

  async validate(accessToken: string, _refreshToken: string, profile: Profile) {
    const peopleApiUrl =
      'https://people.googleapis.com/v1/people/me?personFields=birthdays,genders';
    // People API는 선택 정보(성별/생일)이므로 실패해도 로그인은 진행되어야 함
    let additionalInfo: GooglePeopleApiResponse | undefined;
    try {
      const response = await axios.get<GooglePeopleApiResponse>(peopleApiUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      additionalInfo = response.data;
    } catch {
      additionalInfo = undefined;
    }

    // Extract required fields
    const displayName =
      profile.displayName ??
      [profile.name?.givenName, profile.name?.familyName]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .join(' ');

    const genderValue = additionalInfo?.genders?.[0]?.value;
    const gender =
      genderValue === 'male' ? 'M' : genderValue === 'female' ? 'F' : 'U';

    const date = additionalInfo?.birthdays?.[0]?.date;
    const birthday =
      date && typeof date.month === 'number' && typeof date.day === 'number'
        ? typeof date.year === 'number'
          ? `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
          : `${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
        : null;

    const googleProfile = {
      id: profile.id,
      name: displayName || 'Google User',
      email: profile.emails?.[0]?.value ?? '',
      gender,
      birthday,
    };

    return await this.authService.handleGoogleLogin(googleProfile);
  }
}
