import { ExceptionRulesAdminController } from './exception-rules-admin.controller';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import type { ExceptionRule } from '../types';

function mkRule(overrides: Partial<ExceptionRule> = {}): ExceptionRule {
  return {
    id: 'us.section232.aluminum-smelt-cast',
    destination: 'US',
    authority: 'section_232',
    title: 'Section 232 Aluminum',
    priority: 2200,
    knowledgeCardKeys: ['cbp.csms.55424218'],
    isApplicable: () => false,
    evaluate: () => ({}),
    declaredInputs: () => [],
    ...overrides,
  };
}

class FakeStatus {
  rows: Array<{
    ruleId: string;
    enabled: boolean;
    effectiveFrom: Date | null;
    effectiveTo: Date | null;
    reason: string | null;
  }> = [];
  async list() { return this.rows.slice(); }
  async set(args: { ruleId: string; enabled: boolean; effectiveFrom: Date | null; effectiveTo: Date | null; reason: string | null; changedBy: string }) {
    const i = this.rows.findIndex((r) => r.ruleId === args.ruleId);
    const next = {
      ruleId: args.ruleId,
      enabled: args.enabled,
      effectiveFrom: args.effectiveFrom,
      effectiveTo: args.effectiveTo,
      reason: args.reason,
    };
    if (i >= 0) this.rows[i] = next;
    else this.rows.push(next);
    return next as any;
  }
}

describe('ExceptionRulesAdminController', () => {
  let registry: ExceptionRuleRegistry;
  let status: FakeStatus;
  let controller: ExceptionRulesAdminController;

  beforeEach(() => {
    registry = new ExceptionRuleRegistry();
    status = new FakeStatus();
    controller = new ExceptionRulesAdminController(
      registry,
      status as unknown as RuleStatusService,
    );
  });

  it('returns empty when no rules registered', async () => {
    expect(await controller.list()).toEqual([]);
  });

  it('returns rule summaries with enabled=true defaults', async () => {
    registry.register(mkRule());
    const list = await controller.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'us.section232.aluminum-smelt-cast',
      destination: 'US',
      authority: 'section_232',
      enabled: true,
      knowledgeCardKeys: ['cbp.csms.55424218'],
      effectiveFrom: null,
      effectiveTo: null,
    });
  });

  it('reflects status row in the summary', async () => {
    registry.register(mkRule());
    await status.set({
      ruleId: 'us.section232.aluminum-smelt-cast',
      enabled: false,
      effectiveFrom: null,
      effectiveTo: null,
      reason: 'paused for review',
      changedBy: 'admin',
    });
    const list = await controller.list();
    expect(list[0].enabled).toBe(false);
    expect(list[0].statusReason).toBe('paused for review');
  });

  it('getOne returns error for unknown id', async () => {
    expect(await controller.getOne('nope')).toEqual({ error: 'unknown rule id "nope"' });
  });

  it('updateStatus errors when rule is not registered', async () => {
    const result = await controller.updateStatus(
      'nope',
      { enabled: false } as any,
      { user: { email: 'a@b.com' } },
    );
    expect(result).toEqual({ error: 'unknown rule id "nope"' });
  });

  it('updateStatus calls status.set with the right payload', async () => {
    registry.register(mkRule());
    const result = await controller.updateStatus(
      'us.section232.aluminum-smelt-cast',
      { enabled: false, reason: 'paused' } as any,
      { user: { email: 'a@b.com' } },
    );
    expect(result).toEqual({ ok: true });
    const rows = await status.list();
    expect(rows[0]).toMatchObject({
      ruleId: 'us.section232.aluminum-smelt-cast',
      enabled: false,
      reason: 'paused',
    });
  });
});
