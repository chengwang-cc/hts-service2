import { Controller, Get, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiKeyGuard } from '../../api-keys/guards/api-key.guard';
import { ApiPermissions, CurrentApiKey } from '../../api-keys/decorators';
import { SkipJwtAuth } from '../../api-keys/decorators/skip-jwt-auth.decorator';
import { ApiKeyEntity } from '../../api-keys/entities/api-key.entity';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { PartnerUsageQueryService } from '../services/partner-usage-query.service';

/**
 * Partner-facing usage read API.
 *
 * Authenticated by `X-API-Key`; the API key's organization MUST be of type
 * 'partner' or 'internal'. All queries are scope-fenced to the key's
 * organization — a chitchats key can never see proto data.
 *
 * Required permission: `partner:read` (configured per key in api_keys.permissions).
 */
@ApiTags('Partner — Usage')
@ApiSecurity('api-key')
@SkipJwtAuth()
@Controller('api/v1/partner/usage')
@UseGuards(ApiKeyGuard)
export class PartnerUsageController {
  constructor(
    private readonly query: PartnerUsageQueryService,
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
  ) {}

  /**
   * Enforce the partner scope: the API key must belong to an organization
   * of type 'partner' or 'internal'. Customers / unknown can't read partner
   * usage data.
   */
  private async resolveScope(apiKey: ApiKeyEntity): Promise<string> {
    const org = await this.orgs.findOne({
      where: { id: apiKey.organizationId },
      select: ['id', 'type'],
    });
    if (!org) {
      throw new ForbiddenException('API key is not bound to a known organization');
    }
    if (org.type !== 'partner' && org.type !== 'internal') {
      throw new ForbiddenException('Partner usage API is restricted to partner / internal organizations');
    }
    return org.id;
  }

  @Get('summary')
  @ApiOperation({ summary: 'Aggregate request count + p95 + error rate over the window' })
  @ApiQuery({ name: 'hours', required: false, description: '1..720 (30d), default 24' })
  @ApiPermissions('partner:read')
  @ApiResponse({ status: 200 })
  async summary(@CurrentApiKey() apiKey: ApiKeyEntity, @Query('hours') hours?: string) {
    const partnerId = await this.resolveScope(apiKey);
    const summary = await this.query.summary(partnerId, hours);
    return { data: summary, meta: { partnerId } };
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Per-bucket request count + p95 latency' })
  @ApiQuery({ name: 'hours', required: false })
  @ApiQuery({ name: 'bucket', required: false, description: 'hour | day (default hour)' })
  @ApiPermissions('partner:read')
  async timeseries(
    @CurrentApiKey() apiKey: ApiKeyEntity,
    @Query('hours') hours?: string,
    @Query('bucket') bucket?: 'hour' | 'day',
  ) {
    const partnerId = await this.resolveScope(apiKey);
    const series = await this.query.timeseries(partnerId, hours, bucket);
    return { data: series, meta: { partnerId, bucket: bucket ?? 'hour' } };
  }

  @Get('endpoints')
  @ApiOperation({ summary: 'Top endpoints by request count' })
  @ApiQuery({ name: 'hours', required: false })
  @ApiQuery({ name: 'limit', required: false, description: '1..200, default 25' })
  @ApiPermissions('partner:read')
  async endpoints(
    @CurrentApiKey() apiKey: ApiKeyEntity,
    @Query('hours') hours?: string,
    @Query('limit') limit?: string,
  ) {
    const partnerId = await this.resolveScope(apiKey);
    const data = await this.query.topEndpoints(partnerId, hours, limit);
    return { data, meta: { partnerId } };
  }

  @Get('users')
  @ApiOperation({ summary: 'Top end-users by request count' })
  @ApiQuery({ name: 'hours', required: false, description: '1..720 (30d), default 168 (7d)' })
  @ApiQuery({ name: 'limit', required: false, description: '1..200, default 50' })
  @ApiPermissions('partner:read')
  async users(
    @CurrentApiKey() apiKey: ApiKeyEntity,
    @Query('hours') hours?: string,
    @Query('limit') limit?: string,
  ) {
    const partnerId = await this.resolveScope(apiKey);
    const data = await this.query.topUsers(partnerId, hours, limit);
    return { data, meta: { partnerId } };
  }

  @Get('errors')
  @ApiOperation({ summary: 'Recent 4xx / 5xx samples' })
  @ApiQuery({ name: 'hours', required: false })
  @ApiQuery({ name: 'limit', required: false, description: '1..200, default 50' })
  @ApiPermissions('partner:read')
  async errors(
    @CurrentApiKey() apiKey: ApiKeyEntity,
    @Query('hours') hours?: string,
    @Query('limit') limit?: string,
  ) {
    const partnerId = await this.resolveScope(apiKey);
    const data = await this.query.errorSamples(partnerId, hours, limit);
    return { data, meta: { partnerId } };
  }
}
