import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';
import { AdCvdLookupService } from './ad-cvd-lookup.service';

/**
 * Shared scaffold for per-jurisdiction AD/CVD rules (Phase 9, P9.T4).
 *
 * Each concrete subclass provides:
 *   - `id` (e.g. `us.ad-cvd`)
 *   - `destination` (ISO-2)
 *   - `title` + `knowledgeCardKeys`
 *
 * Behavior:
 *   - `isApplicable()` is cheap — always potentially applicable for the
 *     destination. The expensive DB lookup happens in `evaluate()`.
 *   - `evaluate()` is ASYNC (Phase 9 enabled async evaluate). Returns
 *     a `chapter_99` component with formula `value * cashDepositRate`
 *     when a match exists; an empty decision otherwise.
 *
 * Per-exporter matching: when `exporter_name` is supplied as an
 * additional input, the lookup prefers the per-exporter row; absent
 * that input, the all-others rate applies.
 */
export abstract class AdCvdRuleBase implements ExceptionRule {
  abstract readonly id: string;
  abstract readonly destination: string;
  abstract readonly title: string;
  abstract readonly knowledgeCardKeys: string[];
  readonly authority: ProgramFamily = 'reciprocal';
  readonly priority = 2900;

  constructor(protected readonly lookup: AdCvdLookupService) {}

  isApplicable(ctx: ExceptionRuleContext): boolean {
    return ctx.destination === this.destination;
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'exporter_name',
        type: 'text',
        required: false,
        label: 'Exporter name (for per-exporter AD/CVD rate matching)',
        helpRef:
          this.knowledgeCardKeys[0] ? `knowledge:${this.knowledgeCardKeys[0]}` : undefined,
      },
    ];
  }

  async evaluate(ctx: ExceptionRuleContext): Promise<ExceptionRuleDecision> {
    const exporter = (ctx.additionalInputs['exporter_name'] as string | undefined) ?? null;
    const match = await this.lookup.lookup({
      destinationCountry: this.destination,
      htsCode: ctx.htsCode,
      originCountry: ctx.origin,
      exporterName: exporter,
      asOf: ctx.asOfDate,
    });
    if (!match) return { notes: ['no AD/CVD order in scope'] };

    const component: TariffFormulaComponent = {
      componentType: 'chapter_99',
      formula: `value * ${match.rate}`,
      rateText: `AD/CVD ${match.caseNumber} — ${(match.rate * 100).toFixed(2)}%`,
      description: `${this.destination} AD/CVD cash deposit per order ${match.caseNumber}${
        match.exporterName ? ` (exporter: ${match.exporterName})` : ' (all others)'
      }. ${match.description ?? ''}`.trim(),
      requiredVariables: [{ name: 'value', type: 'number', dimension: 'money' }],
      identifier: `${this.destination}_AD_CVD_${match.caseNumber.replace(/[^A-Z0-9]/gi, '_')}`,
      chapter99HtsCode: null,
      programFamily: 'reciprocal',
      programAuthority: `${this.destination} AD/CVD order`,
      legalReference: match.source,
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: `${this.destination} AD/CVD`,
        rowIdentifier: match.caseNumber,
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    return { add: [component], notes: [`matched ${match.caseNumber}`] };
  }
}
