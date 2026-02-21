import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Query,
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
   * Get API key details
   */
  @Get(':id')
  async getApiKey(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    const keys = await this.apiKeyService.listApiKeys(user.organizationId);
    const key = keys.find((k) => k.id === id);

    if (!key) {
      return { error: 'API key not found' };
    }

    const { keyHash, ...safeKey } = key;
    return safeKey;
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
   * Get usage statistics for an API key
   */
  @Get(':id/usage')
  async getUsageStats(
    @Param('id') id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @CurrentUser() user: UserEntity,
  ) {
    // Verify key belongs to user's organization
    const keys = await this.apiKeyService.listApiKeys(user.organizationId);
    const key = keys.find((k) => k.id === id);

    if (!key) {
      return { error: 'API key not found' };
    }

    const start = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const stats = await this.apiKeyService.getUsageStats(id, start, end);

    return {
      apiKeyId: id,
      startDate: start,
      endDate: end,
      stats,
    };
  }
}
