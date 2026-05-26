import { Injectable } from '@nestjs/common';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';
import { AluminumScopeService } from './helpers/aluminum-scope.service';
import { componentKey } from '../exception-rule-runner.service';

/**
 * Rule: us.section232.aluminum-smelt-cast
 * Authority: Section 232 of the Trade Expansion Act of 1962
 * Scope: HTS codes on CBP's aluminum derivative list, US destination, any
 *        origin (the country-of-smelt and country-of-cast are reported
 *        independently of country-of-origin).
 * Effective from: 2018-03-23 (original Proc 9704); the smelt/cast
 *        reporting requirement effective 2025-06-28 per CSMS 65340246.
 *
 * Sources:
 *   - cbp.csms.55424218 — smelt/cast reporting field requirements
 *   - cbp.csms.55438432 — Proc 10895 implementation details
 *   - cbp.csms.65340246 — Russia 200% derivative rule + unknown-smelt
 *     treatment (effective 2025-06-28)
 *   - fr.proclamation.10895 — Proclamation expanding aluminum to 25%
 *     and adding derivative scope (effective 2025-03-12)
 *
 * Plain-English summary:
 *   For any aluminum-scope HTS imported into the US, importers must
 *   declare three smelt/cast fields. The duty rate depends on those
 *   values:
 *     - All-US smelt + cast → 0% under Chapter 99 code 9903.85.09
 *     - Any Russian primary smelt → 9903.85.67 at 200%
 *     - Any Russian most-recent cast → 9903.85.68 at 200%
 *     - Russian secondary smelt only → 9903.85.69 at 200%
 *     - Any unknown smelt or cast → 9903.85.70 at 200% (CSMS 65340246)
 *     - Otherwise → 9903.85.08 at the standard 25% rate
 *
 * Edge cases:
 *   - `aluminum_pct` defaults to 0 if missing; the component is still
 *     emitted (with $0 duty) so the form surface remains consistent.
 *   - Russia detection: ANY of {primary_smelt, secondary_smelt, cast}
 *     being 'RU' triggers the Russia path; the specific Chapter 99 code
 *     follows CSMS guidance (primary > cast > secondary fallback).
 *   - When this rule is enabled, it removes the metal-tariff-splitter's
 *     `_ALUMINUM` row from the resolver output so the user does not see
 *     two aluminum rows.
 *
 * Conflicts / stacking:
 *   - None declared. The rule operates orthogonally to §301, IEEPA, and
 *     other authorities, all of which apply to the goods value as a
 *     whole and don't double-count the aluminum content.
 *
 * Last reviewed by counsel: PENDING (P2.T9)
 */
@Injectable()
export class Section232AluminumSmeltCastRule implements ExceptionRule {
  readonly id = 'us.section232.aluminum-smelt-cast';
  readonly destination = 'US';
  readonly authority: ProgramFamily = 'section_232';
  readonly title = 'Section 232 Aluminum — Country of Smelt & Cast';
  /** Priority band 2200 (Section 232 inner sub-band per design doc §3.4). */
  readonly priority = 2200;
  readonly knowledgeCardKeys = [
    'cbp.csms.55424218',
    'cbp.csms.55438432',
    'cbp.csms.65340246',
    'fr.proclamation.10895',
  ];

  constructor(private readonly scope: AluminumScopeService) {}

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'US') return false;
    return this.scope.isInScope(ctx.htsCode, ctx.asOfDate);
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'aluminum_primary_smelt',
        type: 'country',
        required: true,
        label: 'Primary Country of Smelt',
        helpRef: 'knowledge:cbp.csms.55424218#primary',
        allowedValues: 'ISO3166-A2 ∪ {UN}',
      },
      {
        name: 'aluminum_secondary_smelt',
        type: 'country',
        required: true,
        label: 'Secondary Country of Smelt (or "Y" if same as primary)',
        helpRef: 'knowledge:cbp.csms.55424218#secondary',
        allowedValues: 'ISO3166-A2 ∪ {UN,Y}',
      },
      {
        name: 'aluminum_cast',
        type: 'country',
        required: true,
        label: 'Country of Most Recent Cast',
        helpRef: 'knowledge:cbp.csms.55424218#cast',
        allowedValues: 'ISO3166-A2 ∪ {UN}',
      },
      {
        name: 'aluminum_pct',
        type: 'percent',
        required: true,
        label: 'Aluminum content (% of declared value)',
        allowedValues: '[0,100]',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const primary = up(ctx.additionalInputs['aluminum_primary_smelt']);
    const secondary = up(ctx.additionalInputs['aluminum_secondary_smelt']);
    const cast = up(ctx.additionalInputs['aluminum_cast']);
    const pct = clampPercent(ctx.additionalInputs['aluminum_pct']);
    const aluminumValue = round2(ctx.declaredValue * (pct / 100));

    // Drop any existing aluminum row the metal splitter emitted so the
    // user sees exactly one row per metal with the correct Chapter 99
    // attribution.
    const removeKeys = ctx.pendingComponents
      .filter(isSplitterAluminumRow)
      .map(componentKey);

    const allUS =
      primary === 'US' &&
      (secondary === 'US' || secondary === 'Y') &&
      cast === 'US';

    if (allUS) {
      return {
        removeKeys,
        add: [
          makeComponent({
            chapter99: '9903.85.09',
            formula: '0',
            rateLabel: 'Aluminum (US smelt + cast exemption)',
            aluminumValue,
            rate: 0,
            legalReference: 'CSMS 55424218; Proc 10895',
            description:
              'Section 232 aluminum content exempt — primary smelt, secondary smelt, and most-recent cast all in the United States.',
          }),
        ],
        notes: ['us-exempt branch'],
      };
    }

    const russiaTouched = [primary, secondary, cast].includes('RU');
    const unknownTouched = [primary, secondary, cast].includes('UN');

    if (russiaTouched || unknownTouched) {
      // Chapter 99 selection per CSMS 65340246:
      //   - Primary smelt RU → 9903.85.67
      //   - Most-recent cast RU (and primary not RU) → 9903.85.68
      //   - Secondary smelt RU only → 9903.85.69
      //   - Any unknown smelt or cast → 9903.85.70
      let chapter99: string;
      let why: string;
      if (primary === 'RU') {
        chapter99 = '9903.85.67';
        why = 'Russia primary smelt';
      } else if (cast === 'RU') {
        chapter99 = '9903.85.68';
        why = 'Russia most-recent cast';
      } else if (secondary === 'RU') {
        chapter99 = '9903.85.69';
        why = 'Russia secondary smelt';
      } else {
        chapter99 = '9903.85.70';
        why = 'unknown smelt or cast';
      }
      return {
        removeKeys,
        add: [
          makeComponent({
            chapter99,
            formula: 'aluminum_value * 2.00',
            rateLabel: `Aluminum (Section 232, 200% — ${why})`,
            aluminumValue,
            rate: 2.0,
            legalReference: 'CSMS 65340246 (effective 2025-06-28)',
            description:
              'Section 232 aluminum content subject to 200% additional duty per CSMS 65340246.',
          }),
        ],
        notes: [`russia-or-unknown branch: ${why}`],
      };
    }

    // Standard 25% path with correct Chapter 99 attribution.
    return {
      removeKeys,
      add: [
        makeComponent({
          chapter99: '9903.85.08',
          formula: 'aluminum_value * 0.25',
          rateLabel: 'Aluminum (Section 232, 25%)',
          aluminumValue,
          rate: 0.25,
          legalReference: 'Proc 10895; FR 90 FR 11251',
          description: 'Section 232 aluminum content subject to the standard 25% additional duty.',
        }),
      ],
      notes: ['standard-25 branch'],
    };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────

function up(v: unknown): string {
  return String(v ?? 'UN').toUpperCase().trim();
}

function clampPercent(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface MakeComponentArgs {
  chapter99: string;
  formula: string;
  rateLabel: string;
  aluminumValue: number;
  rate: number;
  legalReference: string;
  description: string;
}

function makeComponent(args: MakeComponentArgs): TariffFormulaComponent {
  return {
    componentType: 'chapter_99',
    formula: args.formula,
    rateText: args.rateLabel,
    description: args.description,
    requiredVariables: [
      {
        name: 'aluminum_value',
        type: 'number',
        dimension: 'money',
        description: 'Aluminum content value (declared value × aluminum_pct ÷ 100)',
      },
    ],
    identifier: `S232_ALUMINUM_${args.chapter99.replace(/\./g, '')}`,
    chapter99HtsCode: args.chapter99,
    programFamily: 'section_232',
    programAuthority: 'Section 232 of the Trade Expansion Act of 1962',
    legalReference: args.legalReference,
    appliesWhen: { kind: 'always' },
    sourceCitation: {
      source: 'CBP Section 232 Aluminum (Country of Smelt and Cast)',
      rowIdentifier: args.chapter99,
      confidence: 1,
      parserMethod: 'manual',
    },
    confidence: 1,
  };
}

/**
 * Detect a component emitted by the legacy metal-tariff-splitter for the
 * aluminum metal. Splitter identifiers end in `_ALUMINUM` and live under
 * `programFamily: 'section_232'`.
 */
function isSplitterAluminumRow(c: TariffFormulaComponent): boolean {
  if (c.programFamily !== 'section_232') return false;
  const id = (c.identifier || '').toUpperCase();
  return id.endsWith('_ALUMINUM') || id === 'ALUMINUM_AD_VALOREM';
}

