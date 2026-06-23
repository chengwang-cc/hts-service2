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
 * Scope: read-only, fenced to the caller's organizationId. Works for ALL
 * org types — the underlying api_usage_metrics is populated for every
 * signed-in user now that AttributionMiddleware decodes the JWT and tags
 * /lookup/* SPA traffic with the user's org id. Customer-typed orgs see
 * their own search/calculator activity here; previously this endpoint
 * 403'd them and they were stuck on /billing/usage which only reflects
 * tracked feature usage, not raw API hits.
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
   * Resolve the partnerId from the JWT user. Scope-fenced to the caller's
   * own org via the queryService — no cross-org leakage possible. Org-type
   * gating was removed 2026-06-04 because customer orgs now have real
   * api_usage_metrics rows (AttributionMiddleware decodes the SPA JWT and
   * tags /lookup/* traffic with the user's org), so they have legitimate
   * data to display on the same dashboard the partner portal renders.
   */
  private async resolveScope(user: UserEntity): Promise<string> {
    if (!user?.organizationId) {
      throw new UnauthorizedException('User has no organization context');
    }
    const org = await this.orgs.findOne({
      where: { id: user.organizationId },
      select: ['id'],
    });
    if (!org) {
      throw new ForbiddenException('Organization not found');
    }
    return org.id;
  }

  @Get('summary')
  @ApiOperation({ summary: 'Aggregate request count + p95 + error rate over the window' })
  @ApiQuery({ name: 'hours', required: false, description: '1..8760 (365d), default 24' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO 8601 — overrides hours' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO 8601 — overrides hours' })
  @ApiResponse({ status: 200 })
  async summary(
    @CurrentUser() user: UserEntity,
    @Query('hours') hours?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const partnerId = await this.resolveScope(user);
    const data = await this.query.summary(partnerId, { hours, from, to });
    return { data, meta: { partnerId } };
  }

  @Get('endpoints')
  @ApiOperation({ summary: 'Top endpoints by request count' })
  @ApiQuery({ name: 'hours', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO 8601' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO 8601' })
  @ApiQuery({ name: 'limit', required: false, description: '1..200, default 25' })
  async endpoints(
    @CurrentUser() user: UserEntity,
    @Query('hours') hours?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const partnerId = await this.resolveScope(user);
    const data = await this.query.topEndpoints(partnerId, { hours, from, to }, limit);
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

  @Get('cost-by-model')
  @ApiOperation({
    summary: 'Per-model cost + token breakdown over the requested window',
    description:
      'Reads directly from api_usage_metrics so the result reflects in-progress month spend in real time. ' +
      'One row per (model_name) — includes a model_name: null row when the partner has non-AI traffic.',
  })
  @ApiQuery({ name: 'hours', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO 8601' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO 8601' })
  async costByModel(
    @CurrentUser() user: UserEntity,
    @Query('hours') hours?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const partnerId = await this.resolveScope(user);
    const data = await this.query.costByModel(partnerId, { hours, from, to });
    return { data, meta: { partnerId } };
  }
}
