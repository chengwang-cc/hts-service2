import { Injectable } from '@nestjs/common';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';

/**
 * Rule: ca.surtax.cn-steel-aluminum
 * Authority: Customs Tariff §53 (Surtax Order — Chinese steel and aluminum)
 * Scope: Chinese-origin steel (Ch 72/73) and aluminum (Ch 76) imported into
 *        Canada from 2024-10-22.
 *
 * Sources:
 *   - ca.canada-gazette.surtax-cn-steel-aluminum-2024
 *
 * Plain-English summary:
 *   25% surtax on Chinese steel and aluminum. Mirrors the US Section 232
 *   posture; Canada introduced this to align with the US after the 2024
 *   re-imposition.
 *
 * Conflicts / stacking:
 *   - Stacks with base tariff. CUSMA-qualifying goods are technically
 *     within scope but in practice the surtax exempts US/MX-origin goods
 *     entirely (different origin); this rule only fires for CN.
 *
 * Last reviewed by counsel: PENDING (P6.T7)
 */
@Injectable()
export class CaSurtaxCnSteelAluminumRule implements ExceptionRule {
  readonly id = 'ca.surtax.cn-steel-aluminum';
  readonly destination = 'CA';
  readonly authority: ProgramFamily = 'section_232';
  readonly title = 'CA Surtax — Chinese steel & aluminum (+25%)';
  readonly priority = 2810;
  readonly knowledgeCardKeys = ['ca.canada-gazette.surtax-cn-steel-aluminum-2024'];

  private readonly scopeChapters = new Set(['72', '73', '76']);

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'CA') return false;
    if (ctx.origin !== 'CN') return false;
    if (ctx.asOfDate < new Date('2024-10-22')) return false;
    const ch = normalizeHts(ctx.htsCode).slice(0, 2);
    return this.scopeChapters.has(ch);
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const ch = normalizeHts(ctx.htsCode).slice(0, 2);
    const subscope = ch === '76' ? 'aluminum' : 'steel';
    const component: TariffFormulaComponent = {
      componentType: 'chapter_99',
      formula: 'value * 0.25',
      rateText: `25% surtax (CN ${subscope})`,
      description: `CA Surtax on Chinese-origin ${subscope} per Customs Tariff §53 surtax order (Oct 2024).`,
      requiredVariables: [{ name: 'value', type: 'number', dimension: 'money' }],
      identifier: `CA_SURTAX_CN_${subscope.toUpperCase()}_25`,
      programFamily: 'section_232',
      programAuthority: 'Customs Tariff (Canada) §53 Surtax Order',
      legalReference: 'Canada Gazette — CN Steel/Aluminum Surtax',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'CA Dept of Finance — China Steel/Aluminum Surtax',
        rowIdentifier: `cn-${subscope}-25`,
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    return { add: [component], notes: [`25% CN ${subscope} surtax`] };
  }
}

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}
