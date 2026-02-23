import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from '../services/auth.service';

@Injectable()
export class GoogleAuthCallbackGuard extends AuthGuard('google') {
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

  getAuthenticateOptions() {
    return { session: false };
  }
}
