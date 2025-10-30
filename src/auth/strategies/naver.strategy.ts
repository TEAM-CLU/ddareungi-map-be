import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-naver-v2';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import axios from 'axios';

@Injectable()
export class JwtNaverStrategy extends PassportStrategy(Strategy, 'naver') {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: configService.get<string>('NAVER_CLIENT_ID'),
      clientSecret: configService.get<string>('NAVER_CLIENT_SECRET'),
      callbackURL: configService.get<string>('NAVER_CALLBACK_URL'),
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
  ): Promise<any> {
    try {
      // Fetch user profile from Naver API using accessToken
      const response = await axios.get('https://openapi.naver.com/v1/nid/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const naverProfile = response.data;
      console.log('Naver Profile:', naverProfile);

      // Pass the fetched profile to the authService for handling
      const user = await this.authService.handleNaverLogin(naverProfile);
      return user;
    } catch (error) {
      console.error('Error fetching Naver profile:', error);
      throw error;
    }
  }
}
