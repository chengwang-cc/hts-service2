import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';

/**
 * Rule: ca.countermeasure.us-232
 * Authority: Customs Tariff §53 (Countermeasure Order against US §232)
 * Scope: Curated list of US-origin goods (Annex tables). Re-imposed
 *        March 2025 after the US re-imposed Section 232 steel/aluminum.
 *
 * Sources:
 *   - ca.canada-gazette.countermeasure-us-232-2025
 *   - ca.dept-finance.us-countermeasure-list
 *
 * Plain-English summary:
 *   Tariff-line surtax on a list of US-origin goods. The scaffolded
 *   list ships a representative subset; OPS populates the full annex.
 *
 * Conflicts / stacking:
 *   - Does NOT apply to CUSMA-qualifying goods (per the order's text).
 *
 * Last reviewed by counsel: PENDING (P6.T7)
 */
interface CountermeasureScope {
  effectiveFrom: string;
  entries: Array<{
    htsCode: string;
    rate: number;
    category: string;
    source: string;
  }>;
}

@Injectable()
export class CaCountermeasureUs232Rule implements ExceptionRule {
  readonly id = 'ca.countermeasure.us-232';
  readonly destination = 'CA';
  readonly authority: ProgramFamily = 'reciprocal';
  readonly title = 'CA Countermeasure — US §232 (surtax on selected US goods)';
  readonly priority = 2820;
  readonly knowledgeCardKeys = [
    'ca.canada-gazette.countermeasure-us-232-2025',
    'ca.dept-finance.us-countermeasure-list',
  ];

  private readonly scope: CountermeasureScope;
  private readonly byCode: Map<string, CountermeasureScope['entries'][number]>;
  private readonly effectiveFrom: Date;

  constructor() {
    const dataPath = path.join(__dirname, 'data', 'countermeasure-us-232-scope.json');
    this.scope = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as CountermeasureScope;
    this.byCode = new Map();
    for (const e of this.scope.entries) {
      this.byCode.set(normalizeHts(e.htsCode), e);
    }
    this.effectiveFrom = new Date(this.scope.effectiveFrom);
  }

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'CA') return false;
    if (ctx.origin !== 'US') return false;
    if (ctx.asOfDate < this.effectiveFrom) return false;
    if (Boolean(ctx.additionalInputs['cusma_qualifying'])) return false;
    return this.byCode.has(normalizeHts(ctx.htsCode));
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'cusma_qualifying',
        type: 'boolean',
        required: false,
        label: 'CUSMA-qualifying? (certificate of origin on file)',
        helpRef: 'knowledge:ca.dept-finance.us-countermeasure-list#cusma-exemption',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const entry = this.byCode.get(normalizeHts(ctx.htsCode));
    if (!entry) return {};
    const component: TariffFormulaComponent = {
      componentType: 'chapter_99',
      formula: `value * ${entry.rate}`,
      rateText: `${(entry.rate * 100).toFixed(0)}% countermeasure (${entry.category})`,
      description: `Canada countermeasure surtax on US-origin ${entry.category}.`,
      requiredVariables: [{ name: 'value', type: 'number', dimension: 'money' }],
      identifier: `CA_COUNTERMEASURE_US_${entry.category.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
      programFamily: 'reciprocal',
      programAuthority: 'Customs Tariff (Canada) §53 Countermeasure Order',
      legalReference: entry.source,
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'CA Dept of Finance — US §232 Countermeasure',
        rowIdentifier: entry.category,
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    return { add: [component], notes: [`category=${entry.category}`] };
  }
}

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}
