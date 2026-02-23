import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  Profile as GoogleProfile,
  Strategy,
  VerifyCallback,
} from 'passport-google-oauth20';
import { AuthService } from '../services/auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly authService: AuthService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID || 'google-oauth-disabled',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'google-oauth-disabled',
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL ||
        'http://localhost:3100/api/v1/auth/google/callback',
      scope: ['email', 'profile'],
      passReqToCallback: false,
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: GoogleProfile,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      const user = await this.authService.validateGoogleUser(profile);
      done(null, user);
    } catch (error) {
      done(error as Error, undefined);
    }
  }
}
