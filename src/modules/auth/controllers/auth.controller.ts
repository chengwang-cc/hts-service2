import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Patch,
  UnauthorizedException,
  Req,
  Res,
  Query,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { LoginDto, RegisterDto } from '../dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { GoogleAuthGuard } from '../guards/google-auth.guard';
import { GoogleAuthCallbackGuard } from '../guards/google-auth-callback.guard';
import { Public } from '../decorators/public.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserEntity } from '../entities/user.entity';
import { ApiKeyService } from '../../api-keys/services/api-key.service';
import { RegisterRateLimitGuard } from '../guards/register-rate-limit.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly apiKeyService: ApiKeyService,
  ) {}

  @Public()
  @UseGuards(RegisterRateLimitGuard)
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    const user = await this.authService.register(
      registerDto.email,
      registerDto.password,
      registerDto.firstName,
      registerDto.lastName,
      registerDto.organizationId || null,
      registerDto.company,
    );

    // Generate an initial API key for the new organization (only returned once)
    const generated = await this.apiKeyService.generateApiKey({
      organizationId: user.organizationId,
      name: 'Default API Key',
      description: 'Auto-generated on account registration',
      environment: 'live',
      permissions: ['hts:lookup', 'hts:calculate', 'kb:query'],
      createdBy: user.id,
    });

    const auth = await this.authService.login({ id: user.id });

    return {
      ...auth,
      organizationId: user.organizationId,
      apiKey: generated.plainTextKey,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.authService.login(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@CurrentUser() user: UserEntity) {
    return this.authService.toClientUser(user);
  }

  /**
   * Get shipping/integration metadata for the caller's organization.
   * Used by the website Settings page to render the Shopify shipping form.
   */
  @UseGuards(JwtAuthGuard)
  @Get('organization')
  async getOrganization(@CurrentUser() user: UserEntity) {
    const org = await this.authService.getOrganizationForUser(user.organizationId);
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
    return org;
  }

  /**
   * Update shipping/integration metadata for the caller's organization.
   * Only the allowed subset of fields (name, country, shippingCarrier,
   * websiteUrl, integrationType, platform) is persisted.
   */
  @UseGuards(JwtAuthGuard)
  @Patch('organization')
  @HttpCode(HttpStatus.OK)
  async updateOrganization(
    @CurrentUser() user: UserEntity,
    @Body()
    body: {
      name?: string;
      country?: string | null;
      shippingCarrier?: string | null;
      websiteUrl?: string | null;
      integrationType?: string | null;
      platform?: string | null;
    },
  ) {
    return this.authService.updateOrganizationForUser(user.organizationId, body ?? {});
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: { refreshToken: string }) {
    if (!body.refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    try {
      return await this.authService.refreshTokens(body.refreshToken);
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'auth' };
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth(@Query('returnTo') _returnTo?: string) {
    // Intentionally empty: Passport guard redirects to Google.
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthCallbackGuard)
  async googleAuthCallback(
    @Req() req: Request & { user?: { id: string }; query?: Record<string, any> },
    @Res() res: Response,
  ) {
    if (!req.user?.id) {
      const fallback = new URL(
        '/login?oauthError=google_auth_failed',
        process.env.FRONTEND_URL || 'http://localhost:4200',
      );
      return res.redirect(fallback.toString());
    }

    const loginResult = await this.authService.login({ id: req.user.id });
    const rawState =
      typeof req.query?.state === 'string' ? req.query.state : undefined;
    const oauthState = this.authService.readGoogleOauthState(rawState);

    const redirectUrl = new URL(
      '/auth/google/callback',
      process.env.FRONTEND_URL || 'http://localhost:4200',
    );
    const fragmentParams = new URLSearchParams({
      accessToken: loginResult.tokens.accessToken,
      refreshToken: loginResult.tokens.refreshToken,
      returnTo: oauthState.returnTo,
    });

    return res.redirect(`${redirectUrl.toString()}#${fragmentParams.toString()}`);
  }
}
