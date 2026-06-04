import {
  Controller,
  Delete,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { ApiKeyService } from '../services/api-key.service';
import { ApiKeyEntity } from '../entities/api-key.entity';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserEntity } from '../../auth/entities/user.entity';

/**
 * Platform-admin override of revoke/rotate for ANY API key — not just
 * the caller's own org. Used from the admin UI's /admin/orgs/:id page.
 *
 * Mounted at `/api/v1/admin/api-keys`. Auth: JwtAuthGuard + AdminGuard.
 *
 * The user-scoped equivalent lives at /api-keys/:id (rotate, delete) and
 * is restricted to the caller's organizationId. This admin variant
 * relaxes that scope so an operator can revoke a leaked key without
 * impersonating the owning user.
 */
@Controller('api/v1/admin/api-keys')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ApiKeysAdminController {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    @InjectRepository(ApiKeyEntity)
    private readonly apiKeys: Repository<ApiKeyEntity>,
  ) {}

  /** Revoke a key by id, regardless of org. */
  @Delete(':id')
  async revoke(@Param('id') id: string) {
    const existing = await this.apiKeys.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`API key ${id} not found`);
    }
    await this.apiKeyService.revokeApiKey(id);
    return { message: 'API key revoked', id, organizationId: existing.organizationId };
  }

  /**
   * Rotate a key by id, regardless of org. Returns the new plain-text
   * secret exactly once. The previous key is marked inactive
   * immediately; the in-memory validation cache aging is the same
   * 5-minute window as the user-scoped rotate (documented in the
   * portal manual-validation runbook).
   */
  @Post(':id/rotate')
  async rotate(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    const existing = await this.apiKeys.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`API key ${id} not found`);
    }

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
      // Audit trail: who triggered the rotation (the admin), not who
      // originally created the key.
      createdBy: user.id,
    });

    const { keyHash: _hash, ...safe } = apiKey;
    return {
      ...safe,
      organizationId: existing.organizationId,
      previousKeyId: existing.id,
      apiKey: plainTextKey,
      warning: 'Save this credential token now. You will not be able to see it again.',
    };
  }
}
