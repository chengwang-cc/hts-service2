import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyService } from '../services/api-key.service';
import { CreateApiKeyDto } from '../dto/create-api-key.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserEntity } from '../../auth/entities/user.entity';

/**
 * API Keys Controller
 * Manage API keys for an organization (requires JWT authentication)
 */
@Controller('api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  /**
   * Create a new API key
   */
  @Post()
  async createApiKey(
    @Body() createApiKeyDto: CreateApiKeyDto,
    @CurrentUser() user: UserEntity,
  ) {
    const { apiKey, plainTextKey } = await this.apiKeyService.generateApiKey({
      organizationId: user.organizationId,
      name: createApiKeyDto.name,
      description: createApiKeyDto.description,
      environment: createApiKeyDto.environment,
      permissions: createApiKeyDto.permissions,
      rateLimitPerMinute: createApiKeyDto.rateLimitPerMinute,
      rateLimitPerDay: createApiKeyDto.rateLimitPerDay,
      expiresAt: createApiKeyDto.expiresAt
        ? new Date(createApiKeyDto.expiresAt)
        : undefined,
      ipWhitelist: createApiKeyDto.ipWhitelist,
      allowedOrigins: createApiKeyDto.allowedOrigins,
      createdBy: user.id,
    });

    // Remove sensitive data
    const { keyHash, ...safeApiKey } = apiKey;

    return {
      ...safeApiKey,
      // IMPORTANT: This is the only time the plain-text key is shown
      apiKey: plainTextKey,
      warning: 'Save this API key now. You will not be able to see it again.',
    };
  }

  /**
   * List all API keys for the organization
   */
  @Get()
  async listApiKeys(@CurrentUser() user: UserEntity) {
    const keys = await this.apiKeyService.listApiKeys(user.organizationId);

    // Remove sensitive data
    return keys.map(({ keyHash, ...safeKey }) => safeKey);
  }

  /**
   * Revoke an API key
   */
  @Delete(':id')
  async revokeApiKey(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    // Verify key belongs to user's organization
    const keys = await this.apiKeyService.listApiKeys(user.organizationId);
    const key = keys.find((k) => k.id === id);

    if (!key) {
      return { error: 'API key not found' };
    }

    await this.apiKeyService.revokeApiKey(id);

    return {
      message: 'API key revoked successfully',
      id,
    };
  }

  /**
   * Rotate an API key: revoke the existing one and issue a fresh key with
   * the same name/permissions/limits. Returns the plain-text new key once.
   */
  @Post(':id/rotate')
  async rotateApiKey(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
  ) {
    const keys = await this.apiKeyService.listApiKeys(user.organizationId);
    const existing = keys.find((k) => k.id === id);

    if (!existing) {
      return { error: 'API key not found' };
    }

    // Revoke the old key first so the previous secret is immediately unusable.
    await this.apiKeyService.revokeApiKey(existing.id);

    const { apiKey, plainTextKey } = await this.apiKeyService.generateApiKey({
      organizationId: existing.organizationId,
      name: existing.name,
      description: existing.description ?? undefined,
      environment: existing.environment as 'test' | 'live',
      permissions: existing.permissions,
      rateLimitPerMinute: existing.rateLimitPerMinute ?? undefined,
      rateLimitPerDay: existing.rateLimitPerDay ?? undefined,
      expiresAt: existing.expiresAt ?? undefined,
      ipWhitelist: existing.ipWhitelist ?? undefined,
      allowedOrigins: existing.allowedOrigins ?? undefined,
      createdBy: user.id,
    });

    const { keyHash, ...safeApiKey } = apiKey;

    return {
      ...safeApiKey,
      previousKeyId: existing.id,
      apiKey: plainTextKey,
      warning: 'Save this credential token now. You will not be able to see it again.',
    };
  }

}
