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
 * Rule: ca.surtax-cn-ev
 * Authority: Customs Tariff §53 (Surtax Order — Chinese EVs)
 * Scope: Chinese-origin electric vehicles (HS 87.03.80, 87.03.40, 87.03.50,
 *        87.03.60, 87.03.70) imported into Canada from 2024-10-01.
 *
 * Sources:
 *   - ca.canada-gazette.surtax-cn-ev-2024
 *   - ca.dept-finance.cn-ev-100pct
 *
 * Plain-English summary:
 *   100% surtax on Chinese-origin EVs and hybrid vehicles.
 *
 * Conflicts / stacking:
 *   - None declared. Stacks with the base tariff and GST.
 *
 * Last reviewed by counsel: PENDING (P6.T7)
 */
@Injectable()
export class CaSurtaxCnEvRule implements ExceptionRule {
  readonly id = 'ca.surtax.cn-ev';
  readonly destination = 'CA';
  readonly authority: ProgramFamily = 'reciprocal';
  readonly title = 'CA Surtax — Chinese EVs (+100%)';
  readonly priority = 2800;
  readonly knowledgeCardKeys = [
    'ca.canada-gazette.surtax-cn-ev-2024',
    'ca.dept-finance.cn-ev-100pct',
  ];

  private readonly scopePrefixes = new Set([
    '870340', // hybrid (spark-ignition electric)
    '870350', // hybrid (compression-ignition electric)
    '870360', // plug-in hybrid (spark)
    '870370', // plug-in hybrid (diesel)
    '870380', // pure EV
  ]);

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'CA') return false;
    if (ctx.origin !== 'CN') return false;
    if (ctx.asOfDate < new Date('2024-10-01')) return false;
    const p6 = normalizeHts(ctx.htsCode).slice(0, 6);
    return this.scopePrefixes.has(p6);
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const component: TariffFormulaComponent = {
      componentType: 'chapter_99',
      formula: 'value * 1.00',
      rateText: '100% surtax (CN EV)',
      description: 'CA Surtax on Chinese-origin EVs and hybrids per Customs Tariff §53 surtax order (Oct 2024).',
      requiredVariables: [{ name: 'value', type: 'number', dimension: 'money' }],
      identifier: 'CA_SURTAX_CN_EV_100',
      programFamily: 'reciprocal',
      programAuthority: 'Customs Tariff (Canada) §53 Surtax Order',
      legalReference: 'Canada Gazette — CN EV Surtax Order',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'CA Dept of Finance — China EV Surtax',
        rowIdentifier: 'cn-ev-100',
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    return { add: [component], notes: ['100% CN EV surtax'] };
  }
}

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}
