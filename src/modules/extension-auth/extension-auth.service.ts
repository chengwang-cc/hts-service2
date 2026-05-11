import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { AuthService } from '../auth/services/auth.service';
import { ApiKeyService } from '../api-keys/services/api-key.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiKeyEntity } from '../api-keys/entities/api-key.entity';

export interface ExtensionAuthResult {
  apiKey: string;
  plan: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}

// Name used to identify extension-generated API keys
const EXTENSION_KEY_NAME = 'HTS Chrome Extension';

@Injectable()
export class ExtensionAuthService {
  private readonly logger = new Logger(ExtensionAuthService.name);

  constructor(
    private readonly authService: AuthService,
    private readonly apiKeyService: ApiKeyService,
    @InjectRepository(ApiKeyEntity)
    private readonly apiKeyRepository: Repository<ApiKeyEntity>,
  ) {}

  /**
   * Register a new user and auto-generate a FREE-tier extension API key.
   */
  async register(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
  ): Promise<ExtensionAuthResult> {
    // Register user (throws ConflictException if email already exists)
    let user: Awaited<ReturnType<AuthService['register']>>;
    try {
      user = await this.authService.register(email, password, firstName, lastName, null);
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      this.logger.error('Registration failed', err);
      throw new InternalServerErrorException('Registration failed');
    }

    // Auto-create a FREE extension API key for this user
    const plainTextKey = await this.getOrCreateExtensionApiKey(
      user.organizationId,
      user.id,
    );

    return {
      apiKey: plainTextKey,
      plan: (user as any).organization?.plan ?? 'FREE',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  /**
   * Login and return (or create) the user's extension API key.
   */
  async login(email: string, password: string): Promise<ExtensionAuthResult> {
    const user = await this.authService.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const plainTextKey = await this.getOrCreateExtensionApiKey(
      user.organizationId,
      user.id,
    );

    return {
      apiKey: plainTextKey,
      plan: user.organization?.plan ?? 'FREE',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  /**
   * Find an existing extension API key for this org, or create a new one.
   * Returns the plain-text key only on creation; re-creation if no active key exists.
   */
  private async getOrCreateExtensionApiKey(
    organizationId: string,
    userId: string,
  ): Promise<string> {
    // Check for an existing active extension key for this org
    const existing = await this.apiKeyRepository.findOne({
      where: { organizationId, name: EXTENSION_KEY_NAME, isActive: true },
      order: { createdAt: 'DESC' },
    });

    if (existing) {
      // We can't recover the plain-text key — issue a fresh replacement key.
      // Revoke old key and create a new one so user always gets a usable key.
      await this.apiKeyService.revokeApiKey(existing.id);
    }

    const { plainTextKey } = await this.apiKeyService.generateApiKey({
      organizationId,
      name: EXTENSION_KEY_NAME,
      description: 'Auto-generated key for the HTS Chrome Extension',
      environment: 'live',
      permissions: ['hts:lookup', 'hts:calculate'],
      // FREE plan: 10 requests per day, 60 per minute
      rateLimitPerMinute: 60,
      rateLimitPerDay: 10,
      createdBy: userId,
    });

    return plainTextKey;
  }
}
