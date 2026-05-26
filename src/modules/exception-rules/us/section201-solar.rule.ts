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
 * Rule: us.section201.solar
 * Authority: Section 201 of the Trade Act of 1974 (safeguard)
 * Scope: CSPV cells (8541.42) and modules (8541.43). Cells subject to a
 *        TRQ (in-quota 0%, out-of-quota full rate); modules to a flat
 *        rate that steps down annually.
 *
 * Sources:
 *   - fr.proclamation.9693  — Initial Section 201 solar (Feb 2018)
 *   - fr.proclamation.10723 — Extended through 2026
 *   - usitc.investigation.ta-201-75
 *
 * Plain-English summary:
 *   - Modules: flat rate (14.25% FY24, 14.00% FY25, 13.00% FY26) under
 *     9903.45.25
 *   - Cells: 0% in-quota under 9903.45.21; out-of-quota at module rate
 *     under 9903.45.22
 *   - Excluded developing countries (per Proc 9693 annex) bypass the
 *     safeguard
 *
 *   Input:
 *     - `solar_cells_out_of_quota`: boolean — true if the annual cell
 *       TRQ (5 GW) is exhausted
 *
 * Conflicts / stacking:
 *   - None. Stacks with §301 (CN solar) and IEEPA reciprocal.
 *
 * Last reviewed by counsel: PENDING (P4.T9)
 */
interface SolarScopeData {
  rateSchedule: Array<{ effectiveFrom: string; effectiveTo: string; rate: number }>;
  entries: Array<{
    htsCode: string;
    subscope: 'modules' | 'cells_in_quota' | 'cells_out_of_quota';
    chapter99: string;
    effectiveFrom: string;
    source: string;
  }>;
  exemptOrigins: string[];
}

@Injectable()
export class Section201SolarRule implements ExceptionRule {
  private readonly logger = new Logger(Section201SolarRule.name);
  readonly id = 'us.section201.solar';
  readonly destination = 'US';
  readonly authority: ProgramFamily = 'section_201';
  readonly title = 'Section 201 — Solar CSPV cells & modules';
  readonly priority = 2200;
  readonly knowledgeCardKeys = [
    'fr.proclamation.9693',
    'fr.proclamation.10723',
    'usitc.investigation.ta-201-75',
  ];

  private readonly data: SolarScopeData;
  private readonly byCode: Map<string, SolarScopeData['entries'][number]>;

  constructor() {
    const dataPath = path.join(__dirname, 'data', 'section201-solar-scope.json');
    this.data = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as SolarScopeData;
    this.byCode = new Map();
    for (const e of this.data.entries) {
      this.byCode.set(normalizeHts(e.htsCode), e);
    }
  }

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'US') return false;
    if (this.data.exemptOrigins.includes(ctx.origin)) return false;
    return this.byCode.has(normalizeHts(ctx.htsCode));
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'solar_cells_out_of_quota',
        type: 'boolean',
        required: false,
        label: 'Solar cells — annual 5 GW TRQ exhausted?',
        helpRef: 'knowledge:fr.proclamation.10723#cell-trq',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const entry = this.byCode.get(normalizeHts(ctx.htsCode));
    if (!entry) return {};

    const rate = this.rateAt(ctx.asOfDate);
    const subscope =
      entry.subscope === 'cells_in_quota' &&
      Boolean(ctx.additionalInputs['solar_cells_out_of_quota'])
        ? 'cells_out_of_quota'
        : entry.subscope;

    let chapter99 = entry.chapter99;
    let effectiveRate = rate;
    if (subscope === 'cells_in_quota') {
      effectiveRate = 0;
      chapter99 = '9903.45.21';
    } else if (subscope === 'cells_out_of_quota') {
      chapter99 = '9903.45.22';
    }

    return {
      add: [
        makeComponent({
          chapter99,
          formula: `value * ${effectiveRate}`,
          rateLabel: `Section 201 Solar ${subscope.replace(/_/g, ' ')} (${(effectiveRate * 100).toFixed(2)}%)`,
          identifier: `S201_SOLAR_${chapter99.replace(/\./g, '')}`,
          programFamily: 'section_201',
          programAuthority: 'Section 201 of the Trade Act of 1974',
          legalReference: entry.source,
          description: `Section 201 safeguard on CSPV ${subscope.replace(/_/g, ' ')} per Proclamation 9693/10723.`,
          sourceLabel: 'USITC Section 201 — CSPV cells and modules',
        }),
      ],
      notes: [`subscope=${subscope} rate=${effectiveRate}`],
    };
  }

  private rateAt(asOf: Date): number {
    for (const r of this.data.rateSchedule) {
      const from = new Date(r.effectiveFrom);
      const to = new Date(r.effectiveTo);
      if (asOf >= from && asOf < to) return r.rate;
    }
    return 0;
  }
}

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}
