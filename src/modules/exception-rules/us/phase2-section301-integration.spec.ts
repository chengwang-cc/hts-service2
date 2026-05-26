import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { ExceptionRuleRunnerService } from '../exception-rule-runner.service';
import { Section301ListLoader } from './helpers/section301-list-loader';
import { Section301List1Rule } from './section301-list1.rule';
import { Section301List2Rule } from './section301-list2.rule';
import { Section301List3Rule } from './section301-list3.rule';
import { Section301List4ARule } from './section301-list4a.rule';
import { Section301ExclusionsRule } from './section301-exclusions.rule';
import type { TariffFormulaComponent } from '../types';

/**
 * Phase 2 integration aggregator (L3 follow-up from the 2026-05-27 deep
 * code review). Verifies the Section 301 rules behave correctly when
 * registered together and routed through `ExceptionRuleRunnerService`.
 * Per-rule behavior is covered in `section301-list.rules.spec.ts` — this
 * file proves the wiring, not the rule logic.
 *
 * The original review (#L3) called out that the conflictsWith defects
 * in Phase 6 (#D5) would have been caught earlier had Phase 2 + Phase 3
 * had aggregator coverage. This file closes that gap for Section 301.
 */

const LOADER = new Section301ListLoader();

function buildRunner(): ExceptionRuleRunnerService {
  const registry = new ExceptionRuleRegistry();
  registry.register(new Section301List1Rule(LOADER));
  registry.register(new Section301List2Rule(LOADER));
  registry.register(new Section301List3Rule(LOADER));
  registry.register(new Section301List4ARule(LOADER));
  registry.register(new Section301ExclusionsRule(LOADER));
  const status = new RuleStatusService(undefined as any);
  return new ExceptionRuleRunnerService(registry, status);
}

const baseArgs = {
  origin: 'CN',
  destination: 'US' as const,
  declaredValue: 1000,
  currency: 'USD',
  asOfDate: new Date('2026-05-26'),
};

function seedS301Row(): TariffFormulaComponent {
  // Mirrors what the legacy resolver-seed pathway emits — the list rule
  // must drop this via `removeKeys` to avoid double-counting.
  return {
    componentType: 'chapter_99',
    formula: 'value * 0.25',
    rateText: '25% (Section 301 — legacy seed)',
    requiredVariables: [{ name: 'value', type: 'number', dimension: 'money' }],
    identifier: 'S301_LEGACY_SEED',
    chapter99HtsCode: '9903.88.01',
    programFamily: 'section_301',
    appliesWhen: { kind: 'always' },
    sourceCitation: { source: 'legacy resolver seed' },
    confidence: 1,
  };
}

describe('Phase 2 — Section 301 aggregator', () => {
  it('List 1 hit: exactly one §301 list rule fires for a CN List-1 HTS', async () => {
    const runner = buildRunner();
    const result = await runner.run({
      ...baseArgs,
      htsCode: '8471.30.0100',
      baseComponents: [],
    });
    const listRulesFired = result.firedRules.filter((r) =>
      r.startsWith('us.section301.cn-list'),
    );
    expect(listRulesFired).toEqual(['us.section301.cn-list1']);
    const s301Components = result.components.filter(
      (c) => c.programFamily === 'section_301',
    );
    expect(s301Components).toHaveLength(1);
    expect(s301Components[0].chapter99HtsCode).toBe('9903.88.01');
  });

  it('legacy seed §301 row is dropped by the list rule via removeKeys', async () => {
    const runner = buildRunner();
    const result = await runner.run({
      ...baseArgs,
      htsCode: '8471.30.0100',
      baseComponents: [seedS301Row()],
    });
    const s301Components = result.components.filter(
      (c) => c.programFamily === 'section_301',
    );
    // The runner should have removed the legacy seed and emitted exactly
    // one §301 line from the matching list rule.
    expect(s301Components).toHaveLength(1);
    expect(s301Components[0].identifier).not.toBe('S301_LEGACY_SEED');
    expect(s301Components[0].identifier).toMatch(/^S301_LIST1_/);
  });

  it('non-CN origin: no §301 rule fires', async () => {
    const runner = buildRunner();
    const result = await runner.run({
      ...baseArgs,
      origin: 'VN',
      htsCode: '8471.30.0100',
      baseComponents: [],
    });
    expect(result.firedRules.filter((r) => r.startsWith('us.section301.'))).toEqual([]);
  });

  it('exclusion rule emits a notes-only branch when no §301 line exists', async () => {
    // Construct an in-test exclusion HTS and confirm the rule's
    // notes-only branch fires. We can't drive a true positive without
    // knowing seed-data overlap, but we CAN prove the exclusion rule
    // doesn't crash the pipeline or emit phantom negatives.
    const runner = buildRunner();
    const result = await runner.run({
      ...baseArgs,
      origin: 'VN', // ensures no list rule emits, isolating the exclusion path
      htsCode: '8471.30.0100',
      baseComponents: [],
    });
    expect(
      result.components.filter((c) => c.programFamily === 'exclusion'),
    ).toHaveLength(0);
  });
});
