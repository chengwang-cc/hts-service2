import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService } from '../rule-status.service';
import { ExceptionRuleRunnerService } from '../exception-rule-runner.service';
import { SteelScopeService } from './helpers/steel-scope.service';
import { AluminumScopeService } from './helpers/aluminum-scope.service';
import { Section232SteelMeltPourRule } from './section232-steel-melt-pour.rule';
import { Section232SteelRussiaRule } from './section232-steel-russia.rule';
import { Section232SteelKoreaQuotaRule } from './section232-steel-korea-quota.rule';
import { Section232AluminumSmeltCastRule } from './section232-aluminum-smelt-cast.rule';
import type { TariffFormulaComponent } from '../types';

/**
 * Phase 3 integration aggregator (L3 follow-up from the 2026-05-27 deep
 * code review). Verifies the Section 232 steel + aluminum rules behave
 * correctly when registered together and routed through
 * `ExceptionRuleRunnerService`.
 *
 * The conflictsWith wiring (steel-russia and steel-korea-quota declaring
 * a conflict with steel-melt-pour) only works if Defect 4 stays fixed —
 * a pure `{}` decision MUST NOT enter `firedRules`, otherwise the
 * lower-priority steel-melt-pour would block both successors. This
 * suite exercises that interaction end-to-end.
 */

const STEEL = new SteelScopeService();
const ALUMINUM = new AluminumScopeService();

function buildRunner(): ExceptionRuleRunnerService {
  const registry = new ExceptionRuleRegistry();
  registry.register(new Section232SteelMeltPourRule(STEEL));
  registry.register(new Section232SteelRussiaRule(STEEL));
  registry.register(new Section232SteelKoreaQuotaRule(STEEL));
  registry.register(new Section232AluminumSmeltCastRule(ALUMINUM));
  const status = new RuleStatusService(undefined as any);
  return new ExceptionRuleRunnerService(registry, status);
}

const STEEL_HTS = '7208.10.1500';
const ALUMINUM_HTS = '7601.10.3000';

const baseArgs = {
  origin: 'JP',
  destination: 'US' as const,
  declaredValue: 10_000,
  currency: 'USD',
  asOfDate: new Date('2026-05-26'),
};

function steelInputs(
  melt: string,
  pour: string,
  pct = 100,
): Record<string, unknown> {
  return {
    steel_melt_country: melt,
    steel_pour_country: pour,
    steel_pct: pct,
  };
}

describe('Phase 3 — Section 232 aggregator', () => {
  it('standard non-RU non-KR steel: only steel-melt-pour fires', async () => {
    const runner = buildRunner();
    const result = await runner.run({
      ...baseArgs,
      htsCode: STEEL_HTS,
      baseComponents: [],
      additionalInputs: steelInputs('JP', 'JP'),
    });
    expect(result.firedRules).toContain('us.section232.steel-melt-pour');
    expect(result.firedRules).not.toContain('us.section232.steel-russia');
    expect(result.firedRules).not.toContain('us.section232.steel-korea-quota');
    const steelRows = result.components.filter(
      (c) => c.identifier?.startsWith('S232_STEEL_'),
    );
    expect(steelRows).toHaveLength(1);
    expect(steelRows[0].chapter99HtsCode).toBe('9903.80.01');
  });

  it('Russia melt: steel-melt-pour defers, steel-russia fires (D4 + D5 interaction)', async () => {
    const runner = buildRunner();
    const result = await runner.run({
      ...baseArgs,
      origin: 'RU',
      htsCode: STEEL_HTS,
      baseComponents: [],
      additionalInputs: steelInputs('RU', 'RU'),
    });
    // melt-pour's `{}` decision must NOT enter firedRules — otherwise
    // conflictsWith on steel-russia would have skipped it.
    expect(result.firedRules).not.toContain('us.section232.steel-melt-pour');
    expect(result.firedRules).toContain('us.section232.steel-russia');
    expect(result.skippedByConflict).not.toContain('us.section232.steel-russia');
  });

  it('Korea origin, KR melt + pour: korea-quota fires, melt-pour defers', async () => {
    const runner = buildRunner();
    const result = await runner.run({
      ...baseArgs,
      origin: 'KR',
      htsCode: STEEL_HTS,
      baseComponents: [],
      additionalInputs: {
        ...steelInputs('KR', 'KR'),
        steel_kr_in_quota: true,
      },
    });
    expect(result.firedRules).not.toContain('us.section232.steel-melt-pour');
    expect(result.firedRules).toContain('us.section232.steel-korea-quota');
    expect(result.skippedByConflict).not.toContain('us.section232.steel-korea-quota');
  });

  it('aluminum-scope HTS: aluminum rule fires independently of steel rules', async () => {
    const runner = buildRunner();
    const result = await runner.run({
      ...baseArgs,
      htsCode: ALUMINUM_HTS,
      baseComponents: [],
      additionalInputs: {
        aluminum_primary_smelt: 'CA',
        aluminum_secondary_smelt: 'Y',
        aluminum_cast: 'CA',
        aluminum_pct: 100,
      },
    });
    expect(result.firedRules).toContain('us.section232.aluminum-smelt-cast');
    // No steel rule should have fired for an aluminum HTS.
    expect(
      result.firedRules.filter((r) => r.startsWith('us.section232.steel-')),
    ).toEqual([]);
  });

  it('drops legacy splitter _STEEL row and emits a single attributed line', async () => {
    const runner = buildRunner();
    const splitterSteel: TariffFormulaComponent = {
      componentType: 'chapter_99',
      formula: 'value * 0.25',
      requiredVariables: [{ name: 'value', type: 'number', dimension: 'money' }],
      identifier: 'LEGACY_STEEL',
      programFamily: 'section_232',
      appliesWhen: { kind: 'always' },
      sourceCitation: { source: 'legacy metal-tariff-splitter' },
      confidence: 1,
    };
    const result = await runner.run({
      ...baseArgs,
      htsCode: STEEL_HTS,
      baseComponents: [splitterSteel],
      additionalInputs: steelInputs('JP', 'JP'),
    });
    const s232Rows = result.components.filter(
      (c) => c.programFamily === 'section_232',
    );
    expect(s232Rows).toHaveLength(1);
    expect(s232Rows[0].identifier).toMatch(/^S232_STEEL_/);
    expect(s232Rows[0].identifier).not.toBe('LEGACY_STEEL');
  });
});
