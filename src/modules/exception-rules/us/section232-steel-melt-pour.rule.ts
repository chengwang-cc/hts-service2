import { Injectable } from '@nestjs/common';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';
import { SteelScopeService } from './helpers/steel-scope.service';
import { componentKey } from '../exception-rule-runner.service';

/**
 * Rule: us.section232.steel-melt-pour
 * Authority: Section 232 of the Trade Expansion Act of 1962
 * Scope: HTS codes on CBP's steel + derivative-steel list, US
 *        destination, any origin.
 * Effective from: 2018-03-23 (Proc 9705); reporting requirement
 *        formalized 2020-10-09 per CSMS 56495736.
 *
 * Sources:
 *   - cbp.csms.56495736 — Country of Melt and Pour reporting requirement
 *   - fr.proclamation.9705 — Original Section 232 steel proclamation
 *   - fr.proclamation.10896 — 2025 derivative expansion (steel)
 *
 * Plain-English summary:
 *   For any steel-scope HTS imported into the US, importers must
 *   declare the Country of Melt and the Country of Pour. The standard
 *   25% duty (Chapter 99 9903.80.01) applies; the Russia rule (200%) is
 *   handled by us.section232.steel-russia, and the Korea TRQ exemption
 *   is handled by us.section232.steel-korea-quota.
 *
 * Edge cases:
 *   - `steel_pct` defaults to 0 if missing.
 *   - When this rule is enabled, it drops any splitter-emitted `_STEEL`
 *     row and emits its own with Chapter 99 attribution.
 *
 * Conflicts / stacking:
 *   - none declared. The Korea-quota and Russia-200% rules use
 *     `conflictsWith: ['us.section232.steel-melt-pour']` so only one
 *     fires per quote.
 *
 * Last reviewed by counsel: PENDING (P3.T11)
 */
@Injectable()
export class Section232SteelMeltPourRule implements ExceptionRule {
  readonly id = 'us.section232.steel-melt-pour';
  readonly destination = 'US';
  readonly authority: ProgramFamily = 'section_232';
  readonly title = 'Section 232 Steel — Country of Melt & Pour (standard 25%)';
  readonly priority = 2100; // before steel-russia (2110) and korea-quota (2105)
  readonly knowledgeCardKeys = [
    'cbp.csms.56495736',
    'fr.proclamation.9705',
    'fr.proclamation.10896',
  ];

  constructor(private readonly scope: SteelScopeService) {}

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'US') return false;
    return this.scope.isInScope(ctx.htsCode, ctx.asOfDate);
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'steel_melt_country',
        type: 'country',
        required: true,
        label: 'Country of Melt',
        helpRef: 'knowledge:cbp.csms.56495736#melt',
        allowedValues: 'ISO3166-A2 ∪ {UN}',
      },
      {
        name: 'steel_pour_country',
        type: 'country',
        required: true,
        label: 'Country of Pour',
        helpRef: 'knowledge:cbp.csms.56495736#pour',
        allowedValues: 'ISO3166-A2 ∪ {UN}',
      },
      {
        name: 'steel_pct',
        type: 'percent',
        required: true,
        label: 'Steel content (% of declared value)',
        allowedValues: '[0,100]',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const melt = up(ctx.additionalInputs['steel_melt_country']);
    const pour = up(ctx.additionalInputs['steel_pour_country']);

    // Russia-touched lines defer to us.section232.steel-russia. Korea
    // origin in-quota defers to us.section232.steel-korea-quota. Both
    // rules check that this rule has NOT already fired; we check the
    // mirror here so the standard 25% line doesn't get emitted when
    // either special path is about to take it.
    if (melt === 'RU' || pour === 'RU') {
      return {}; // steel-russia will emit
    }
    if (ctx.origin === 'KR' && melt === 'KR' && pour === 'KR') {
      // korea-quota path takes over for KR-origin in-quota volume
      return {};
    }

    const removeKeys = ctx.pendingComponents
      .filter(isSplitterSteelRow)
      .map(componentKey);

    return {
      removeKeys,
      add: [
        makeSteelComponent({
          chapter99: '9903.80.01',
          formula: 'steel_value * 0.25',
          rateLabel: 'Steel (Section 232, 25%)',
          legalReference: 'Proc 9705; CSMS 56495736',
          description:
            'Section 232 steel content subject to the standard 25% additional duty.',
        }),
      ],
      notes: ['standard-25 branch'],
    };
  }
}

// ─── helpers (also used by the russia + korea-quota rules in this dir) ───

export function up(v: unknown): string {
  return String(v ?? 'UN').toUpperCase().trim();
}

export function clampPercent(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 100 ? 100 : n;
}

export function isSplitterSteelRow(c: TariffFormulaComponent): boolean {
  if (c.programFamily !== 'section_232') return false;
  const id = (c.identifier || '').toUpperCase();
  return id.endsWith('_STEEL') || id === 'STEEL_AD_VALOREM';
}


export interface MakeSteelComponentArgs {
  chapter99: string;
  formula: string;
  rateLabel: string;
  legalReference: string;
  description: string;
}

export function makeSteelComponent(
  args: MakeSteelComponentArgs,
): TariffFormulaComponent {
  return {
    componentType: 'chapter_99',
    formula: args.formula,
    rateText: args.rateLabel,
    description: args.description,
    requiredVariables: [
      {
        name: 'steel_value',
        type: 'number',
        dimension: 'money',
        description: 'Steel content value (declared value × steel_pct ÷ 100)',
      },
    ],
    identifier: `S232_STEEL_${args.chapter99.replace(/\./g, '')}`,
    chapter99HtsCode: args.chapter99,
    programFamily: 'section_232',
    programAuthority: 'Section 232 of the Trade Expansion Act of 1962',
    legalReference: args.legalReference,
    appliesWhen: { kind: 'always' },
    sourceCitation: {
      source: 'CBP Section 232 Steel (Country of Melt and Pour)',
      rowIdentifier: args.chapter99,
      confidence: 1,
      parserMethod: 'manual',
    },
    confidence: 1,
  };
}
