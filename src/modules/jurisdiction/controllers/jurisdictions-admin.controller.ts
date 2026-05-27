import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { JurisdictionEntity } from '../entities/jurisdiction.entity';

/**
 * Admin endpoints for jurisdiction lifecycle (W0.5.T3 — 2026-05-26).
 *
 *   GET  /admin/jurisdictions               list all with state
 *   GET  /admin/jurisdictions/{code}        single
 *   PUT  /admin/jurisdictions/{code}/state  transition the country state
 *
 * Country state machine:
 *   SOURCE_VALIDATION  → SHADOW  → BETA  → PRODUCTION
 *                                              ↺
 *                                           PAUSED
 *
 * Auth: E1/E2/E3 pattern — JWT only, `req.user.organizationId` must be
 * present, no fallback to `req.organizationId`. Permission check:
 * caller must have `admin:jurisdictions` in their role.
 */

const VALID_STATES = [
  'SOURCE_VALIDATION',
  'SHADOW',
  'BETA',
  'PRODUCTION',
  'PAUSED',
] as const;
type CountryState = typeof VALID_STATES[number];

interface StateTransitionDto {
  state: CountryState;
  reason?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/jurisdictions')
export class JurisdictionsAdminController {
  constructor(
    @InjectRepository(JurisdictionEntity)
    private readonly repo: Repository<JurisdictionEntity>,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List every jurisdiction with its current state',
  })
  async list(@Req() req: any): Promise<JurisdictionEntity[]> {
    this.requireAdminContext(req);
    return this.repo.find({ order: { code: 'ASC' } });
  }

  @Get(':code')
  @ApiOperation({ summary: 'Fetch a single jurisdiction' })
  async getOne(
    @Param('code') code: string,
    @Req() req: any,
  ): Promise<JurisdictionEntity> {
    this.requireAdminContext(req);
    const j = await this.repo.findOne({ where: { code: code.toUpperCase() } });
    if (!j) throw new NotFoundException(`Jurisdiction ${code} not found`);
    return j;
  }

  @Put(':code/state')
  @ApiOperation({
    summary: 'Transition the country lifecycle state',
    description:
      'Valid transitions: SOURCE_VALIDATION → SHADOW → BETA → PRODUCTION. ' +
      'PAUSED is reachable from any state. State must be a valid value; ' +
      'unknown values return 400.',
  })
  async updateState(
    @Param('code') code: string,
    @Body() body: StateTransitionDto,
    @Req() req: any,
  ): Promise<JurisdictionEntity> {
    this.requireAdminContext(req);
    if (!body || !body.state) {
      throw new BadRequestException('state is required');
    }
    if (!VALID_STATES.includes(body.state)) {
      throw new BadRequestException(
        `state must be one of: ${VALID_STATES.join(', ')}`,
      );
    }
    const j = await this.repo.findOne({ where: { code: code.toUpperCase() } });
    if (!j) throw new NotFoundException(`Jurisdiction ${code} not found`);
    j.countryState = body.state;
    return this.repo.save(j);
  }

  /**
   * E1/E2/E3 fail-closed auth shape. JWT route only trusts
   * `req.user.organizationId` — never `req.organizationId`. Also
   * requires the caller to carry `admin:jurisdictions` permission.
   */
  private requireAdminContext(req: any): void {
    const userOrg = req?.user?.organizationId;
    if (!userOrg) {
      throw new ForbiddenException('Authenticated organization is required');
    }
    const perms: string[] = req?.user?.permissions ?? [];
    if (!perms.includes('admin:jurisdictions') && !perms.includes('admin:*')) {
      throw new ForbiddenException(
        'Missing required permission: admin:jurisdictions',
      );
    }
  }
}
