import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
} from '../types';
import { makeComponent } from './helpers/component.helper';

/**
 * Rule: us.ieepa.reciprocal-baseline
 * Authority: IEEPA Reciprocal Tariff (EO 14257)
 * Scope: All goods entered into the US on/after 2025-04-09, except
 *        from exempt origins (US, territories, USMCA-qualifying MX/CA).
 *
 * Sources:
 *   - fr.eo.14257  — Reciprocal tariff EO
 *   - cbp.csms.64287000
 *   - ustr.deal.*  — country-specific deal references in the matrix
 *
 * Plain-English summary:
 *   A 10% global baseline reciprocal tariff applies to all
 *   non-exempt-origin imports. Country-specific deals (UK 10%,
 *   EU 15%, JP 15%, KR 15%, …) override the baseline rate AND the
 *   Chapter 99 attribution code.
 *
 *   Data:
 *   `hts-service/src/modules/exception-rules/us/data/reciprocal-deal-matrix.json`
 *
 * Conflicts / stacking:
 *   - Stacks with §301, §232, and IEEPA fentanyl. All are additive ad
 *     valorem duties on the customs value.
 *   - Does not apply to USMCA-qualifying MX/CA goods (matches the
 *     fentanyl-MX/CA rules' exemption logic).
 *
 * Last reviewed by counsel: PENDING (P4.T9)
 */
interface DealMatrixData {
  baselineRate: number;
  baselineChapter99: string;
  baselineEffectiveFrom: string;
  deals: Array<{
    country: string;
    rate: number;
    chapter99: string;
    effectiveFrom: string;
    effectiveTo?: string;
    source: string;
    note?: string;
  }>;
  exemptOrigins: string[];
}

@Injectable()
export class IeepaReciprocalBaselineRule implements ExceptionRule {
  private readonly logger = new Logger(IeepaReciprocalBaselineRule.name);
  readonly id = 'us.ieepa.reciprocal-baseline';
  readonly destination = 'US';
  readonly authority: ProgramFamily = 'reciprocal';
  readonly title = 'IEEPA Reciprocal Baseline (EO 14257)';
  readonly priority = 2900;
  readonly knowledgeCardKeys = [
    'fr.eo.14257',
    'cbp.csms.64287000',
    'ustr.deal.uk-2025',
    'ustr.deal.eu-2025',
    'ustr.deal.japan-2025',
  ];

  private readonly matrix: DealMatrixData;
  private readonly dealByCountry: Map<string, DealMatrixData['deals'][number]>;
  private readonly baselineEffectiveFrom: Date;

  constructor() {
    const dataPath = path.join(__dirname, 'data', 'reciprocal-deal-matrix.json');
    this.matrix = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as DealMatrixData;
    this.dealByCountry = new Map();
    for (const d of this.matrix.deals) {
      this.dealByCountry.set(d.country.toUpperCase(), d);
    }
    this.baselineEffectiveFrom = new Date(this.matrix.baselineEffectiveFrom);
    this.logger.log(
      `reciprocal-baseline loaded: ${this.matrix.deals.length} country deals, baseline ${(this.matrix.baselineRate * 100).toFixed(0)}%`,
    );
  }

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'US') return false;
    if (ctx.asOfDate < this.baselineEffectiveFrom) return false;
    if (this.matrix.exemptOrigins.includes(ctx.origin)) return false;
    if ((ctx.origin === 'MX' || ctx.origin === 'CA') &&
        Boolean(ctx.additionalInputs['usmca_qualifying'])) {
      return false;
    }
    return true;
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const deal = this.dealByCountry.get(ctx.origin);
    let rate = this.matrix.baselineRate;
    let chapter99 = this.matrix.baselineChapter99;
    let source = 'fr.eo.14257';
    let note = 'baseline 10%';
    if (deal && ctx.asOfDate >= new Date(deal.effectiveFrom)) {
      if (!deal.effectiveTo || ctx.asOfDate < new Date(deal.effectiveTo)) {
        rate = deal.rate;
        chapter99 = deal.chapter99;
        source = deal.source;
        note = `deal: ${ctx.origin} ${(rate * 100).toFixed(0)}%`;
      }
    }

    return {
      add: [
        makeComponent({
          chapter99,
          formula: `value * ${rate}`,
          rateLabel: `Reciprocal baseline (${(rate * 100).toFixed(0)}%)`,
          identifier: `IEEPA_RECIPROCAL_${ctx.origin}_${chapter99.replace(/\./g, '')}`,
          programFamily: 'reciprocal',
          programAuthority: 'IEEPA Reciprocal Tariff (EO 14257)',
          legalReference: source,
          description: `Reciprocal tariff on imports from ${ctx.origin} per EO 14257${deal ? ` (deal-specific rate)` : ' (baseline)'}.`,
          sourceLabel: 'CBP IEEPA reciprocal tariff program',
        }),
      ],
      notes: [note],
    };
  }
}
