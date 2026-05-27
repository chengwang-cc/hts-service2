import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';
import { componentKey } from '../exception-rule-runner.service';

/**
 * Shared scaffold for "FTA-qualifying preferential treatment" rules
 * across Phase 6 (CA / KR / AU / NZ FTAs). Each concrete rule provides:
 *
 *   - `id` (e.g. `kr.korus.qualifying`)
 *   - `destination` (the importing country)
 *   - `agreementCode` (the trade-agreement label shown in the UI;
 *     also the `additionalInputs[{code}_qualifying]` flag name)
 *   - `title` and `knowledgeCardKeys`
 *   - `qualifyingOrigins`: ISO-2 set of partner-country origins that
 *     can qualify under the agreement
 *
 * Applicability: destination matches AND origin in `qualifyingOrigins`
 * AND the input flag `{agreementCode}_qualifying` is true.
 *
 * Action: replaces the base/special/non_ntr component(s) with a zeroed
 * `special` component citing the agreement. Does NOT exempt §232, §301,
 * IEEPA, CBAM, or any other remedy — preferential treatment is base-rate
 * only.
 */
export abstract class FtaQualifyingRuleBase implements ExceptionRule {
  abstract readonly id: string;
  abstract readonly destination: string;
  abstract readonly agreementCode: string;
  abstract readonly title: string;
  abstract readonly knowledgeCardKeys: string[];
  protected abstract readonly qualifyingOrigins: ReadonlySet<string>;
  /** FTA rules live in the country-preference band (design doc §3.4). */
  readonly priority = 6000;
  readonly authority: ProgramFamily = 'special';

  /**
   * 2026-05-27: scope-only check — destination + origin in partner set.
   * Independent of the user's flag, so the formula endpoint can surface
   * this rule's input even when the flag hasn't been set yet (avoiding
   * the catch-22 where the input never renders because the flag is
   * unset). `isApplicable` adds the flag check on top.
   */
  isInScope(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination.toUpperCase() !== this.destination) return false;
    return this.qualifyingOrigins.has(ctx.origin.toUpperCase());
  }

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (!this.isInScope(ctx)) return false;
    return Boolean(ctx.additionalInputs[this.qualifyingFlag()]);
  }

  declaredInputs(ctx?: ExceptionRuleContext): ExceptionRuleInputSpec[] {
    // Pre-check the flag when the user's origin is in the partner set —
    // shipments from MX/CA to the US (or any FTA partner pair) default
    // to the preferential treatment without forcing the user to opt-in.
    // User can uncheck to override if the goods don't meet rules of origin.
    const originQualifies = ctx?.origin
      ? this.qualifyingOrigins.has(ctx.origin.toUpperCase())
      : undefined;
    return [
      {
        name: this.qualifyingFlag(),
        type: 'boolean',
        required: false,
        label: `${this.agreementCode} — qualifying with certificate of origin on file?`,
        helpRef: this.knowledgeCardKeys[0]
          ? `knowledge:${this.knowledgeCardKeys[0]}`
          : undefined,
        defaultValue: originQualifies,
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const baseRows = ctx.pendingComponents.filter(isBaseLike);
    const identifier = `${this.agreementCode.replace(/[^A-Z0-9]/gi, '_').toUpperCase()}_QUALIFYING`;
    if (baseRows.length === 0) {
      // 2026-05-26: when no base row exists (the destination adapter
      // didn't surface one for this HS), still ADD a zero-rate
      // preferential component so the audit + firedRules manifest
      // reflect that the FTA was applied. The runner's hadEffect gate
      // requires a component mutation to record `firedRules`; emitting
      // only `notes` makes the rule invisible to downstream consumers.
      const synthetic: TariffFormulaComponent = {
        componentType: 'special',
        formula: '0',
        rateText: `${this.agreementCode} preferential — 0% (no base rate from adapter)`,
        description: `Goods qualify under ${this.agreementCode}; certificate of origin on file. No base rate available from the destination adapter.`,
        requiredVariables: [],
        identifier,
        programFamily: 'special',
        programAuthority: `${this.agreementCode} Trade Agreement`,
        legalReference: this.knowledgeCardKeys[0] ?? this.agreementCode,
        appliesWhen: { kind: 'always' },
        confidence: 0.7,
        sourceCitation: {
          source: this.knowledgeCardKeys[0] ?? this.agreementCode,
          confidence: 0.7,
          parserMethod: 'fta_qualifying_rule_synthetic',
          rowIdentifier: this.id,
        },
      };
      return {
        add: [synthetic],
        notes: [`${this.agreementCode} preferential applied (no base row present)`],
      };
    }
    const replaced: TariffFormulaComponent = {
      ...baseRows[0],
      formula: '0',
      rateText: `${this.agreementCode} preferential — 0%`,
      description: `Goods qualify under ${this.agreementCode}; certificate of origin on file.`,
      identifier,
      programFamily: 'special',
      programAuthority: `${this.agreementCode} Trade Agreement`,
      legalReference: this.knowledgeCardKeys[0] ?? this.agreementCode,
    };
    return {
      replace: [{ key: componentKey(baseRows[0]), with: replaced }],
      removeKeys: baseRows.slice(1).map(componentKey),
      notes: [`${this.agreementCode} preferential applied`],
    };
  }

  protected qualifyingFlag(): string {
    return `${this.agreementCode.toLowerCase().replace(/-/g, '_')}_qualifying`;
  }
}

function isBaseLike(c: TariffFormulaComponent): boolean {
  const t = c.componentType;
  return t === 'base' || t === 'special' || t === 'non_ntr';
}

