import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { RuleStatusUpdateDto } from '../dto/rule-status-update.dto';
import { RuleSummaryDto } from '../dto/rule-summary.dto';

/**
 * Admin endpoint surface for the exception-rule engine (Phase 1, P1.T9).
 *
 *   GET    /admin/exception-rules                — list with current enabled state
 *   GET    /admin/exception-rules/:id            — single rule detail
 *   PUT    /admin/exception-rules/:id/status     — toggle enabled / window / reason
 *
 * Auth: JWT (existing guard). Role enforcement (admin-only) is delegated
 * to whatever role guard is currently wrapping admin routes in this
 * project — added in P1's PR if not already on the route.
 *
 * Phase 1 returns an empty list because no rules are registered yet.
 * Phase 2 and on populate it.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/exception-rules')
export class ExceptionRulesAdminController {
  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all registered exception rules with their current enabled state.' })
  @ApiOkResponse({ type: [RuleSummaryDto] })
  async list(): Promise<RuleSummaryDto[]> {
    const rules = this.registry.all();
    if (rules.length === 0) return [];
    const statusMap = await this.status.list();
    const byId = new Map(statusMap.map((s) => [s.ruleId, s]));
    return rules.map((r): RuleSummaryDto => {
      const s = byId.get(r.id);
      return {
        id: r.id,
        destination: r.destination,
        authority: r.authority,
        title: r.title,
        priority: r.priority,
        enabled: s ? s.enabled : true,
        knowledgeCardKeys: r.knowledgeCardKeys,
        conflictsWith: r.conflictsWith ?? [],
        effectiveFrom: s?.effectiveFrom ? s.effectiveFrom.toISOString() : null,
        effectiveTo: s?.effectiveTo ? s.effectiveTo.toISOString() : null,
        statusReason: s?.reason ?? null,
      };
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one exception rule by id.' })
  @ApiOkResponse({ type: RuleSummaryDto })
  async getOne(@Param('id') id: string): Promise<RuleSummaryDto | { error: string }> {
    const r = this.registry.get(id);
    if (!r) return { error: `unknown rule id "${id}"` };
    const status = await this.status.list();
    const s = status.find((x) => x.ruleId === id);
    return {
      id: r.id,
      destination: r.destination,
      authority: r.authority,
      title: r.title,
      priority: r.priority,
      enabled: s ? s.enabled : true,
      knowledgeCardKeys: r.knowledgeCardKeys,
      conflictsWith: r.conflictsWith ?? [],
      effectiveFrom: s?.effectiveFrom ? s.effectiveFrom.toISOString() : null,
      effectiveTo: s?.effectiveTo ? s.effectiveTo.toISOString() : null,
      statusReason: s?.reason ?? null,
    };
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Enable / disable an exception rule, optionally bounded by an effective window.' })
  async updateStatus(
    @Param('id') id: string,
    @Body() body: RuleStatusUpdateDto,
    @Req() req: any,
  ): Promise<{ ok: true } | { error: string }> {
    if (!this.registry.get(id)) {
      return { error: `unknown rule id "${id}"` };
    }
    const changedBy = req?.user?.email ?? req?.user?.id ?? 'admin';
    await this.status.set({
      ruleId: id,
      enabled: body.enabled,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : null,
      effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
      reason: body.reason ?? null,
      changedBy,
    });
    return { ok: true };
  }
}
