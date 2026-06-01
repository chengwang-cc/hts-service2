import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { ApiKeyService } from '../../api-keys/services/api-key.service';
import { ApiKeyEntity } from '../../api-keys/entities/api-key.entity';
import { OrganizationEntity } from '../../auth/entities/organization.entity';

interface CreatePartnerBrowserKeyDto {
  /** Human-readable label for the key. */
  name: string;
  /**
   * Required for browser keys — at least one origin pattern. Supports exact
   * hosts and `*.example.com` subdomain globs.
   */
  allowedOrigins: string[];
  /** Optional override of the default 30/min rate limit. Max 600. */
  rateLimitPerMinute?: number;
  /** Optional override of the default 2000/day rate limit. Max 100000. */
  rateLimitPerDay?: number;
  /** Optional override of the default permissions: ['partner:read']. */
  permissions?: string[];
  /** Environment label. Defaults to 'live'. */
  environment?: 'test' | 'live';
}

/**
 * Internal admin endpoints for managing partner-scoped API keys (server +
 * browser purpose). Server keys can also be issued via the existing
 * /api/v1/api-keys controller, but browser keys have stricter validation
 * (allowedOrigins is required) so they get a dedicated route.
 */
@ApiTags('Admin — Partner API Keys')
@Controller('api/v1/admin/partners')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PartnerApiKeyAdminController {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(ApiKeyEntity)
    private readonly apiKeys: Repository<ApiKeyEntity>,
  ) {}

  /**
   * Create a browser-purpose API key bound to a partner organization.
   * Returns the plain-text key ONCE — caller must capture and pass it on.
   */
  @Post(':slug/browser-keys')
  @ApiOperation({ summary: 'Create a browser-purpose API key for a partner' })
  @ApiResponse({ status: 201, description: 'Key created; plainTextKey returned ONCE.' })
  @ApiResponse({ status: 400, description: 'Validation failed (e.g. missing allowedOrigins)' })
  @ApiResponse({ status: 404, description: 'Partner not found' })
  async createBrowserKey(
    @Param('slug') slug: string,
    @Body() dto: CreatePartnerBrowserKeyDto,
  ): Promise<{
    id: string;
    keyPrefix: string;
    plainTextKey: string;
    organizationId: string;
    purpose: 'browser';
    allowedOrigins: string[];
    rateLimitPerMinute: number;
    rateLimitPerDay: number;
  }> {
    if (!dto?.name || !dto.name.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!Array.isArray(dto.allowedOrigins) || dto.allowedOrigins.length === 0) {
      throw new BadRequestException(
        'allowedOrigins is required for browser-purpose keys — embedding a key in client code without an origin allow-list is unsafe.',
      );
    }
    const rpm = dto.rateLimitPerMinute;
    if (rpm !== undefined && (!Number.isFinite(rpm) || rpm < 1 || rpm > 600)) {
      throw new BadRequestException('rateLimitPerMinute must be between 1 and 600');
    }
    const rpd = dto.rateLimitPerDay;
    if (rpd !== undefined && (!Number.isFinite(rpd) || rpd < 1 || rpd > 100000)) {
      throw new BadRequestException('rateLimitPerDay must be between 1 and 100000');
    }

    const org = await this.orgs.findOne({ where: { slug } });
    if (!org) throw new NotFoundException(`Partner with slug "${slug}" not found`);
    if (org.type !== 'partner' && org.type !== 'internal') {
      throw new BadRequestException(
        `Browser keys can only be issued to partner / internal organizations (got type=${org.type})`,
      );
    }

    const { apiKey, plainTextKey } = await this.apiKeyService.generateApiKey({
      organizationId: org.id,
      name: dto.name.trim(),
      environment: dto.environment ?? 'live',
      purpose: 'browser',
      permissions: dto.permissions && dto.permissions.length > 0 ? dto.permissions : ['partner:read'],
      allowedOrigins: dto.allowedOrigins.map((s) => s.trim()).filter((s) => s.length > 0),
      rateLimitPerMinute: rpm,
      rateLimitPerDay: rpd,
    });

    return {
      id: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      plainTextKey,
      organizationId: apiKey.organizationId,
      purpose: 'browser',
      allowedOrigins: apiKey.allowedOrigins ?? [],
      rateLimitPerMinute: apiKey.rateLimitPerMinute,
      rateLimitPerDay: apiKey.rateLimitPerDay,
    };
  }

  /**
   * List all (non-revoked) API keys for a partner. Plain-text key NOT returned.
   */
  @Get(':slug/api-keys')
  @ApiOperation({ summary: 'List API keys for a partner' })
  async listKeys(@Param('slug') slug: string): Promise<
    Array<{
      id: string;
      name: string;
      keyPrefix: string;
      purpose: 'server' | 'browser';
      permissions: string[];
      allowedOrigins: string[] | null;
      rateLimitPerMinute: number;
      rateLimitPerDay: number;
      isActive: boolean;
      lastUsedAt: string | null;
      createdAt: string;
    }>
  > {
    const org = await this.orgs.findOne({ where: { slug } });
    if (!org) throw new NotFoundException(`Partner with slug "${slug}" not found`);

    const rows = await this.apiKeys.find({
      where: { organizationId: org.id },
      order: { createdAt: 'DESC' },
    });
    return rows.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      purpose: k.purpose,
      permissions: k.permissions,
      allowedOrigins: k.allowedOrigins,
      rateLimitPerMinute: k.rateLimitPerMinute,
      rateLimitPerDay: k.rateLimitPerDay,
      isActive: k.isActive,
      lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
      createdAt: k.createdAt.toISOString(),
    }));
  }
}
