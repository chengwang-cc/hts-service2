import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from '../services/auth.service';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly authService: AuthService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (!this.authService.isGoogleOauthConfigured()) {
      throw new ServiceUnavailableException(
        'Google OAuth is not configured on the server',
      );
    }
    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const returnTo =
      typeof request?.query?.returnTo === 'string'
        ? request.query.returnTo
        : undefined;

    return {
      scope: ['email', 'profile'],
      prompt: 'select_account',
      accessType: 'offline',
      session: false,
      state: this.authService.buildGoogleOauthState(returnTo),
    };
  }
}
