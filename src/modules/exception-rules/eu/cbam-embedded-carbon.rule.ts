import { Injectable } from '@nestjs/common';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleInputSpec,
  ProgramFamily,
  TariffFormulaComponent,
} from '../types';
import { CbamScopeService } from './cbam-scope.service';
import { parseNumericInputWithNote } from '../_shared/numeric-input';

/**
 * Rule: eu.cbam.embedded-carbon
 * Authority: Regulation (EU) 2023/956 (CBAM)
 * Scope: Cement, iron/steel, aluminum, fertilizers, electricity,
 *        hydrogen — per CBAM Annex I (transitional + definitive).
 *
 * Sources:
 *   - eu.regulation.2023-956
 *   - eu.commission.cbam-implementing-regulation
 *   - eu.commission.cbam-default-values-2025
 *
 * Plain-English summary:
 *   Importers must declare embedded direct + indirect emissions per
 *   tonne of CBAM-scope goods. Where verified exporter declarations
 *   are not provided, EU defaults apply (with a "default applied" badge
 *   on the breakdown).
 *
 *   Provisional CBAM cost line:
 *     `(direct_emissions + indirect_emissions) × quantity ×
 *      (1 - free_allocation_share) × certificate_price_eur_per_tCO2e`
 *
 *   This is an ADVISORY component — the financial obligation is
 *   settled quarterly with the CBAM Registry, NOT at import. The
 *   component's `componentType` is `post_tax` and its description
 *   carries the disclaimer.
 *
 * Conflicts / stacking:
 *   - None. Stacks with VAT/duty/safeguards.
 *
 * Last reviewed by counsel: PENDING (P7.T8)
 */
@Injectable()
export class CbamEmbeddedCarbonRule implements ExceptionRule {
  readonly id = 'eu.cbam.embedded-carbon';
  readonly destination = 'EU';
  readonly authority: ProgramFamily = 'tax';
  readonly title = 'EU CBAM — Embedded Carbon';
  readonly priority = 9100;
  readonly knowledgeCardKeys = [
    'eu.regulation.2023-956',
    'eu.commission.cbam-implementing-regulation',
    'eu.commission.cbam-default-values-2025',
  ];

  constructor(private readonly scope: CbamScopeService) {}

  isApplicable(ctx: ExceptionRuleContext): boolean {
    if (ctx.destination !== 'EU') return false;
    return this.scope.isInScope(ctx.htsCode);
  }

  declaredInputs(): ExceptionRuleInputSpec[] {
    return [
      {
        name: 'eu_cbam_quantity_tonnes',
        type: 'number',
        required: false,
        label: 'Goods quantity (tonnes) — required for CBAM cost calculation',
        helpRef: 'knowledge:eu.regulation.2023-956',
      },
      {
        name: 'eu_cbam_direct_emissions',
        type: 'number',
        required: false,
        label: 'Embedded direct emissions (tCO₂e / tonne) — leave blank to use EU default',
      },
      {
        name: 'eu_cbam_indirect_emissions',
        type: 'number',
        required: false,
        label: 'Embedded indirect emissions (tCO₂e / tonne) — leave blank to use EU default',
      },
      {
        name: 'eu_cbam_exporter_declaration_attached',
        type: 'boolean',
        required: false,
        label: 'Verified exporter emissions declaration on file?',
      },
    ];
  }

  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision {
    const sector = this.scope.sectorFor(ctx.htsCode) ?? 'unknown';
    const defaults = this.scope.defaultEmissions(ctx.htsCode);
    const a = ctx.additionalInputs;
    // A1 fix (2026-05-26): strict numeric parsing — booleans rejected,
    // comma-formatted strings tolerated. The notes feed quote.warnings
    // via the D5/G3 propagation in CalculatorV2QuoteService.
    const inputNotes: string[] = [];
    const [quantity, qNote] = parseNumericInputWithNote(
      'eu_cbam_quantity_tonnes',
      a['eu_cbam_quantity_tonnes'],
      { min: 0, defaultIfMissing: 0, fallback: 0 },
    );
    if (qNote) inputNotes.push(qNote);
    const hasExporter = Boolean(a['eu_cbam_exporter_declaration_attached']);
    const directParsed = parseNumericInputWithNote(
      'eu_cbam_direct_emissions',
      a['eu_cbam_direct_emissions'],
      { min: 0 },
    );
    const indirectParsed = parseNumericInputWithNote(
      'eu_cbam_indirect_emissions',
      a['eu_cbam_indirect_emissions'],
      { min: 0 },
    );
    const directDeclared = directParsed[0];
    const indirectDeclared = indirectParsed[0];
    const directOk = directParsed[1] === null;
    const indirectOk = indirectParsed[1] === null;

    const useDeclared = hasExporter && directOk && indirectOk;
    const direct = useDeclared ? directDeclared : (defaults?.direct ?? 0);
    const indirect = useDeclared ? indirectDeclared : (defaults?.indirect ?? 0);
    const defaultApplied = !useDeclared;

    const year = ctx.asOfDate.getFullYear();
    const freeShare = this.scope.freeAllocationShare(year);
    const certPrice = this.scope.certificatePriceEurPerTCO2e();

    const cbamCertificates = quantity * (direct + indirect) * (1 - freeShare);
    const provisionalCost = cbamCertificates * certPrice;

    const component: TariffFormulaComponent = {
      componentType: 'post_tax',
      formula: `${round4(provisionalCost)}`,
      rateText: `CBAM provisional — €${round4(certPrice)}/tCO₂e × ${round4(cbamCertificates)} tCO₂e`,
      description: [
        `CBAM provisional cost (advisory — quarterly settlement, not paid at import).`,
        `Sector: ${sector}.`,
        `Embedded emissions: direct=${round4(direct)} + indirect=${round4(indirect)} tCO₂e/t.`,
        defaultApplied ? `Using EU DEFAULT values (no verified exporter declaration on file).` : 'Using verified exporter declaration.',
        `Free-allocation share for ${year}: ${(freeShare * 100).toFixed(1)}%.`,
        `Quarterly settlement obligation: ${round4(cbamCertificates)} CBAM certificates × €${certPrice} = €${round4(provisionalCost)}.`,
      ].join(' '),
      requiredVariables: [
        { name: 'eu_cbam_quantity_tonnes', type: 'number', dimension: 'weight' },
      ],
      identifier: `EU_CBAM_${sector.toUpperCase()}`,
      programFamily: 'tax',
      programAuthority: 'Regulation (EU) 2023/956 (CBAM)',
      legalReference: 'EU CBAM Reg 2023/956 + Implementing Reg',
      appliesWhen: { kind: 'always' },
      sourceCitation: {
        source: 'EU Commission — CBAM',
        rowIdentifier: `cbam-${sector}`,
        confidence: 1,
        parserMethod: 'manual',
      },
      confidence: 1,
    };
    const notes = [
      `sector=${sector} defaultApplied=${defaultApplied} certificates=${round4(cbamCertificates)} costEUR=${round4(provisionalCost)}`,
      ...inputNotes,
    ];
    if (defaultApplied) {
      notes.push(
        'CBAM default emissions applied (no verified exporter declaration on file).',
      );
    }
    // C2/C3 fix (2026-05-26): emit structured data so the quote
    // service's CBAM persistence pass can read sector / certificates /
    // defaultApplied / provisionalCostEur directly instead of regex-
    // parsing the notes string.
    return {
      add: [component],
      notes,
      data: {
        sector,
        defaultApplied,
        cbamCertificates: round4(cbamCertificates),
        provisionalCostEur: round4(provisionalCost),
      },
    };
  }
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
