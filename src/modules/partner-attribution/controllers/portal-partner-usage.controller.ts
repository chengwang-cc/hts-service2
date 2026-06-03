import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserEntity } from '../../auth/entities/user.entity';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { PartnerUsageQueryService } from '../services/partner-usage-query.service';

/**
 * JWT-gated companion to PartnerUsageController. Used by the partner portal
 * UI in hts-web2 — the browser holds a JWT (from /auth/login), not an API
 * key, so it can't call the X-API-Key-gated /api/v1/partner/usage/* routes.
 *
 * Same data shape as PartnerUsageController (`{ data, meta }`) so the
 * frontend type model is shared.
 *
 * Scope: read-only, fenced to the caller's organizationId. Org type must
 * be 'partner' or 'internal' (customers don't have partner usage data;
 * they should be on /billing/usage instead).
 *
 * Final URL: /api/v1/portal/partner-usage/* (global prefix prepends api/v1).
 */
@ApiTags('Portal — Partner Usage')
@Controller('portal/partner-usage')
@UseGuards(JwtAuthGuard)
export class PortalPartnerUsageController {
  constructor(
    private readonly query: PartnerUsageQueryService,
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
  ) {}

  /**
   * Resolve the partnerId from the JWT user and fence by org type. Throws
   * 403 if the user's org isn't a partner / internal — those orgs should
   * use the /billing/usage endpoint, not partner-flavored aggregates.
   */
  private async resolveScope(user: UserEntity): Promise<string> {
    if (!user?.organizationId) {
      throw new UnauthorizedException('User has no organization context');
    }
    const org = await this.orgs.findOne({
      where: { id: user.organizationId },
      select: ['id', 'type'],
    });
    if (!org) {
      throw new ForbiddenException('Organization not found');
    }
    if (org.type !== 'partner' && org.type !== 'internal') {
      throw new ForbiddenException(
        'Partner usage data is restricted to partner / internal organizations',
      );
    }
    return org.id;
  }

  @Get('summary')
  @ApiOperation({ summary: 'Aggregate request count + p95 + error rate over the window' })
  @ApiQuery({ name: 'hours', required: false, description: '1..720 (30d), default 24' })
  @ApiResponse({ status: 200 })
  async summary(@CurrentUser() user: UserEntity, @Query('hours') hours?: string) {
    const partnerId = await this.resolveScope(user);
    const data = await this.query.summary(partnerId, hours);
    return { data, meta: { partnerId } };
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Per-bucket request count + p95 latency' })
  @ApiQuery({ name: 'hours', required: false })
  @ApiQuery({ name: 'bucket', required: false, description: 'hour | day (default hour)' })
  async timeseries(
    @CurrentUser() user: UserEntity,
    @Query('hours') hours?: string,
    @Query('bucket') bucket?: 'hour' | 'day',
  ) {
    const partnerId = await this.resolveScope(user);
    const data = await this.query.timeseries(partnerId, hours, bucket);
    return { data, meta: { partnerId, bucket: bucket ?? 'hour' } };
  }

  @Get('endpoints')
  @ApiOperation({ summary: 'Top endpoints by request count' })
  @ApiQuery({ name: 'hours', required: false })
  @ApiQuery({ name: 'limit', required: false, description: '1..200, default 25' })
  async endpoints(
    @CurrentUser() user: UserEntity,
    @Query('hours') hours?: string,
    @Query('limit') limit?: string,
  ) {
    const partnerId = await this.resolveScope(user);
    const data = await this.query.topEndpoints(partnerId, hours, limit);
    return { data, meta: { partnerId } };
  }

  @Get('users')
  @ApiOperation({ summary: 'Top end-users by request count' })
  @ApiQuery({ name: 'hours', required: false })
  @ApiQuery({ name: 'limit', required: false, description: '1..200, default 50' })
  async users(
    @CurrentUser() user: UserEntity,
    @Query('hours') hours?: string,
    @Query('limit') limit?: string,
  ) {
    const partnerId = await this.resolveScope(user);
    const data = await this.query.topUsers(partnerId, hours, limit);
    return { data, meta: { partnerId } };
  }

  @Get('errors')
  @ApiOperation({ summary: 'Recent 4xx / 5xx samples' })
  @ApiQuery({ name: 'hours', required: false })
  @ApiQuery({ name: 'limit', required: false, description: '1..200, default 50' })
  async errors(
    @CurrentUser() user: UserEntity,
    @Query('hours') hours?: string,
    @Query('limit') limit?: string,
  ) {
    const partnerId = await this.resolveScope(user);
    const data = await this.query.errorSamples(partnerId, hours, limit);
    return { data, meta: { partnerId } };
  }

  @Get('costs')
  @ApiOperation({
    summary: 'Per-month $-cost and request totals',
    description: 'Reads from partner_usage_monthly. Sums per calendar month over the requested window.',
  })
  @ApiQuery({ name: 'months', required: false, description: '1..24, default 3' })
  async costs(@CurrentUser() user: UserEntity, @Query('months') months?: string) {
    const partnerId = await this.resolveScope(user);
    const data = await this.query.costSummary(partnerId, months);
    return { data, meta: { partnerId } };
  }
}
