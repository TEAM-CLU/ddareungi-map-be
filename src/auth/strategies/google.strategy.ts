import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import axios from 'axios';

@Injectable()
export class JwtGoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const options = {
      clientID: configService.get('GOOGLE_CLIENT_ID'),
      clientSecret: configService.get('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.get('GOOGLE_CALLBACK_URL'),
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

  async validate(accessToken: string, refreshToken: string, profile: any) {
    const peopleApiUrl =
      'https://people.googleapis.com/v1/people/me?personFields=birthdays,genders';
    const response = await axios.get(peopleApiUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const additionalInfo = response.data;

    // Extract required fields
    const googleProfile = {
      id: profile.id,
      name:
        profile.displayName ||
        `${profile.name.givenName} ${profile.name.familyName}`,
      email: profile.emails?.[0]?.value || '',
      gender: additionalInfo.genders?.[0]?.value === 'male' ? 'M' : 'W',
      birthday: additionalInfo.birthdays?.[0]?.date
        ? `${additionalInfo.birthdays[0].date.year}-${additionalInfo.birthdays[0].date.month}-${additionalInfo.birthdays[0].date.day}`
        : 'unknown',
    };

    console.log('Google Profile:', googleProfile);
    return await this.authService.handleGoogleLogin(googleProfile);
  }
}
