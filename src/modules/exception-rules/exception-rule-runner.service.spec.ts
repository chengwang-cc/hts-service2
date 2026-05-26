import { ExceptionRuleRegistry } from './exception-rule.registry';
import { RuleStatusService } from './rule-status.service';
import {
  ExceptionRuleRunnerService,
  applyDecision,
  componentKey,
} from './exception-rule-runner.service';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  TariffFormulaComponent,
} from './types';

function mkComponent(
  overrides: Partial<TariffFormulaComponent> = {},
): TariffFormulaComponent {
  return {
    componentType: 'base',
    formula: 'value * 0.1',
    requiredVariables: [],
    appliesWhen: { kind: 'always' },
    sourceCitation: { source: 'test' },
    confidence: 1,
    programFamily: 'base',
    ...overrides,
  };
}

function mkRule(overrides: Partial<ExceptionRule>): ExceptionRule {
  return {
    id: 'test.rule',
    destination: 'US',
    authority: 'section_232',
    title: 'Test rule',
    priority: 1000,
    knowledgeCardKeys: [],
    isApplicable: () => true,
    evaluate: () => ({}),
    declaredInputs: () => [],
    ...overrides,
  };
}

function mkRunner(rules: ExceptionRule[]): ExceptionRuleRunnerService {
  const registry = new ExceptionRuleRegistry();
  for (const r of rules) registry.register(r);
  const status = new RuleStatusService(undefined as any); // always-enabled default
  return new ExceptionRuleRunnerService(registry, status);
}

const baseRunArgs = {
  htsCode: '6109.10.0004',
  origin: 'CN',
  destination: 'US',
  declaredValue: 1000,
  currency: 'USD',
};

describe('ExceptionRuleRunnerService', () => {
  it('passes through unchanged when no rules registered', async () => {
    const runner = mkRunner([]);
    const base = [mkComponent({ identifier: 'b1' })];
    const result = await runner.run({ ...baseRunArgs, baseComponents: base });
    expect(result.components).toEqual(base);
    expect(result.firedRules).toEqual([]);
    expect(result.skippedByConflict).toEqual([]);
    expect(result.notes).toEqual({});
  });

  it('applies an add-only decision', async () => {
    const extra = mkComponent({
      componentType: 'chapter_99',
      formula: 'value * 0.25',
      identifier: 'extra',
      chapter99HtsCode: '9903.85.08',
      programFamily: 'section_232',
    });
    const runner = mkRunner([
      mkRule({
        id: 'r-add',
        evaluate: () => ({ add: [extra] }),
      }),
    ]);
    const base = [mkComponent({ identifier: 'b1' })];
    const result = await runner.run({ ...baseRunArgs, baseComponents: base });
    expect(result.components).toEqual([...base, extra]);
    expect(result.firedRules).toEqual(['r-add']);
  });

  it('applies a removeKeys decision', async () => {
    const b1 = mkComponent({
      identifier: 'b1',
      programFamily: 'section_232',
      chapter99HtsCode: '9903.85.08',
    });
    const b2 = mkComponent({ identifier: 'b2', programFamily: 'base' });
    const key = componentKey(b1);
    const runner = mkRunner([
      mkRule({ id: 'r-rm', evaluate: () => ({ removeKeys: [key] }) }),
    ]);
    const result = await runner.run({
      ...baseRunArgs,
      baseComponents: [b1, b2],
    });
    expect(result.components).toEqual([b2]);
    expect(result.firedRules).toEqual(['r-rm']);
  });

  it('applies a replace decision', async () => {
    const original = mkComponent({
      identifier: 'b1',
      programFamily: 'section_232',
      chapter99HtsCode: '9903.85.08',
      formula: 'aluminum_value * 0.25',
    });
    const replacement = {
      ...original,
      formula: 'aluminum_value * 2.00',
      chapter99HtsCode: '9903.85.67',
    };
    const runner = mkRunner([
      mkRule({
        id: 'r-replace',
        evaluate: () => ({
          replace: [{ key: componentKey(original), with: replacement }],
        }),
      }),
    ]);
    const result = await runner.run({
      ...baseRunArgs,
      baseComponents: [original],
    });
    expect(result.components).toEqual([replacement]);
    expect(result.firedRules).toEqual(['r-replace']);
  });

  it('skips rule when isApplicable returns false', async () => {
    const runner = mkRunner([
      mkRule({ id: 'r-no', isApplicable: () => false, evaluate: () => ({ add: [mkComponent()] }) }),
    ]);
    const base = [mkComponent({ identifier: 'b1' })];
    const result = await runner.run({ ...baseRunArgs, baseComponents: base });
    expect(result.components).toEqual(base);
    expect(result.firedRules).toEqual([]);
  });

  it('skips rule with conflictsWith already fired', async () => {
    const extraA = mkComponent({ identifier: 'a' });
    const extraB = mkComponent({ identifier: 'b' });
    const runner = mkRunner([
      mkRule({ id: 'r-a', priority: 1000, evaluate: () => ({ add: [extraA] }) }),
      mkRule({
        id: 'r-b',
        priority: 2000,
        conflictsWith: ['r-a'],
        evaluate: () => ({ add: [extraB] }),
      }),
    ]);
    const base = [mkComponent({ identifier: 'b1' })];
    const result = await runner.run({ ...baseRunArgs, baseComponents: base });
    expect(result.components).toEqual([...base, extraA]);
    expect(result.firedRules).toEqual(['r-a']);
    expect(result.skippedByConflict).toEqual(['r-b']);
  });

  it('runs in priority order', async () => {
    const fired: string[] = [];
    const runner = mkRunner([
      mkRule({
        id: 'late',
        priority: 5000,
        isApplicable: () => { fired.push('late-check'); return true; },
        evaluate: () => { fired.push('late-eval'); return { add: [mkComponent({ identifier: 'late-c' })] }; },
      }),
      mkRule({
        id: 'early',
        priority: 1000,
        isApplicable: () => { fired.push('early-check'); return true; },
        evaluate: () => { fired.push('early-eval'); return { add: [mkComponent({ identifier: 'early-c' })] }; },
      }),
    ]);
    const result = await runner.run({ ...baseRunArgs, baseComponents: [] });
    expect(result.firedRules).toEqual(['early', 'late']);
    expect(fired).toEqual(['early-check', 'early-eval', 'late-check', 'late-eval']);
  });

  it('continues when a rule throws in evaluate', async () => {
    const ok = mkComponent({ identifier: 'ok' });
    const runner = mkRunner([
      mkRule({
        id: 'boom',
        priority: 1000,
        evaluate: () => { throw new Error('boom'); },
      }),
      mkRule({
        id: 'ok',
        priority: 2000,
        evaluate: () => ({ add: [ok] }),
      }),
    ]);
    const result = await runner.run({ ...baseRunArgs, baseComponents: [] });
    expect(result.components).toEqual([ok]);
    expect(result.firedRules).toEqual(['ok']);
  });

  it('captures rule notes', async () => {
    const runner = mkRunner([
      mkRule({
        id: 'r-notes',
        evaluate: () => ({ notes: ['used fallback rate'] }),
      }),
    ]);
    const result = await runner.run({ ...baseRunArgs, baseComponents: [] });
    expect(result.notes).toEqual({ 'r-notes': ['used fallback rate'] });
  });

  // C2/C3 fix (2026-05-26): structured per-rule data flows through the runner.
  it('captures structured rule data under result.data', async () => {
    const runner = mkRunner([
      mkRule({
        id: 'r-data',
        evaluate: () => ({
          add: [mkComponent({ identifier: 'x' })],
          data: { sector: 'iron_steel', cbamCertificates: 12.5, defaultApplied: true },
        }),
      }),
    ]);
    const result = await runner.run({ ...baseRunArgs, baseComponents: [] });
    expect(result.data).toEqual({
      'r-data': { sector: 'iron_steel', cbamCertificates: 12.5, defaultApplied: true },
    });
  });

  it('omits data entry when decision.data is empty or missing', async () => {
    const runner = mkRunner([
      mkRule({
        id: 'r-nodata',
        evaluate: () => ({ add: [mkComponent({ identifier: 'y' })] }),
      }),
    ]);
    const result = await runner.run({ ...baseRunArgs, baseComponents: [] });
    expect(result.data).toEqual({});
  });

  // H4 fix (2026-05-26): async timeout wrapper.
  it('times out a slow async rule and continues with the rest', async () => {
    const previous = process.env.EXCEPTION_RULE_TIMEOUT_MS;
    process.env.EXCEPTION_RULE_TIMEOUT_MS = '50';
    // Track the slow rule's timer so the test can release it before
    // jest tears down the worker; otherwise the 500ms timer keeps the
    // event loop alive past the test.
    let slowTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      const ok = mkComponent({ identifier: 'after-timeout' });
      const runner = mkRunner([
        mkRule({
          id: 'slow',
          priority: 1000,
          evaluate: () =>
            new Promise((resolve) => {
              slowTimer = setTimeout(() => {
                resolve({ add: [mkComponent({ identifier: 'never' })] });
              }, 500);
            }),
        }),
        mkRule({
          id: 'ok',
          priority: 2000,
          evaluate: () => ({ add: [ok] }),
        }),
      ]);
      const result = await runner.run({ ...baseRunArgs, baseComponents: [] });
      expect(result.firedRules).toEqual(['ok']);
      expect(result.components.some((c) => c.identifier === 'never')).toBe(false);
    } finally {
      if (slowTimer) clearTimeout(slowTimer);
      if (previous === undefined) delete process.env.EXCEPTION_RULE_TIMEOUT_MS;
      else process.env.EXCEPTION_RULE_TIMEOUT_MS = previous;
    }
  });

  it('skips a rule when status service reports it disabled', async () => {
    const registry = new ExceptionRuleRegistry();
    const rule = mkRule({
      id: 'disabled',
      evaluate: () => ({ add: [mkComponent({ identifier: 'x' })] }),
    });
    registry.register(rule);
    const status = {
      isEnabled: async (id: string) => id !== 'disabled',
    } as unknown as RuleStatusService;
    const runner = new ExceptionRuleRunnerService(registry, status);
    const result = await runner.run({ ...baseRunArgs, baseComponents: [] });
    expect(result.firedRules).toEqual([]);
    expect(result.components).toEqual([]);
  });
});

describe('applyDecision', () => {
  it('removeKeys then replace then add — in that order', () => {
    const a = mkComponent({ identifier: 'a', programFamily: 'base' });
    const b = mkComponent({ identifier: 'b', programFamily: 'base' });
    const bReplaced = { ...b, formula: 'replaced' };
    const added = mkComponent({ identifier: 'added', programFamily: 'tax' });
    const out = applyDecision([a, b], {
      removeKeys: [componentKey(a)],
      replace: [{ key: componentKey(b), with: bReplaced }],
      add: [added],
    });
    expect(out).toEqual([bReplaced, added]);
  });

  it('is a no-op when decision is empty', () => {
    const base = [mkComponent({ identifier: 'b1' })];
    expect(applyDecision(base, {})).toEqual(base);
  });
});
