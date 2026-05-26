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

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination.toUpperCase() !== this.destination) return false;
    if (!this.qualifyingOrigins.has(ctx.origin.toUpperCase())) return false;
    const flagName = this.qualifyingFlag();
    return Boolean(ctx.additionalInputs[flagName]);
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: this.qualifyingFlag(),
        type: 'boolean',
        required: false,
        label: `${this.agreementCode} — qualifying with certificate of origin on file?`,
        helpRef: this.knowledgeCardKeys[0]
          ? `knowledge:${this.knowledgeCardKeys[0]}`
          : undefined,
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const baseRows = ctx.pendingComponents.filter(isBaseLike);
    if (baseRows.length === 0) {
      return { notes: [`${this.agreementCode} qualifying but no base row present`] };
    }
    const replaced: TariffFormulaComponent = {
      ...baseRows[0],
      formula: '0',
      rateText: `${this.agreementCode} preferential — 0%`,
      description: `Goods qualify under ${this.agreementCode}; certificate of origin on file.`,
      identifier: `${this.agreementCode.replace(/[^A-Z0-9]/gi, '_').toUpperCase()}_QUALIFYING`,
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

