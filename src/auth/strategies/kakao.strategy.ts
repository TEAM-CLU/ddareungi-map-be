import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-kakao';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import axios from 'axios';

@Injectable()
export class JwtKakaoStrategy extends PassportStrategy(Strategy, 'kakao') {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const options = {
      clientID: configService.get('KAKAO_CLIENT_ID'),
      clientSecret: configService.get('KAKAO_CLIENT_SECRET'),
      callbackURL: configService.get('KAKAO_CALLBACK_URL'),
    };

    super(options);
  }

  async validate(accessToken: string, refreshToken: string, profile: any) {
    try {
      // Fetch user profile from Kakao API using accessToken
      const response = await axios.get('https://kapi.kakao.com/v2/user/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const kakaoProfile = response.data;

      // Pass the fetched profile to the authService for handling
      const user = await this.authService.handleKakaoLogin(kakaoProfile);
      return user;
    } catch (error) {
      console.error('Error fetching Kakao profile:', error);
      throw error;
    }
  }
}
