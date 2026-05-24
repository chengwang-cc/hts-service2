import { Injectable } from '@nestjs/common';

export interface HkControlWarning {
  type: string;
  severity: 'block' | 'warn' | 'info';
  description: string;
}

/**
 * HkComplianceResolverService (P5.2)
 *
 * Surface license / permit / restricted goods warnings for HK imports.
 * The HK compliance regime covers (non-exhaustive):
 *   - Cap 60 (Import and Export Ordinance): pharmaceutical and chemical
 *     substances, rough diamonds, strategic commodities, optical disc
 *     mastering equipment, textiles for re-export.
 *   - Reserved Commodities Ordinance: rice import quotas.
 *   - Pharmacy and Poisons Ordinance: human pharmaceuticals.
 *   - Endangered Species: CITES.
 *
 * Until ControlEntity rows are seeded by ops, this resolver returns
 * heuristic warnings keyed by HS prefix.
 */
@Injectable()
export class HkComplianceResolverService {
  resolve(hsCode: string): HkControlWarning[] {
    const digits = (hsCode || '').replace(/\D/g, '');
    const warnings: HkControlWarning[] = [];

    if (!digits) return warnings;

    // Pharmaceuticals
    if (digits.startsWith('30')) {
      warnings.push({
        type: 'license_pharmaceutical',
        severity: 'warn',
        description:
          'Pharmaceutical product imports require registration / import license under HK Pharmacy and Poisons Ordinance (Cap. 138).',
      });
    }

    // CITES (live animals, ivory, certain plants)
    if (digits.startsWith('01') || digits.startsWith('05') || digits.startsWith('44')) {
      warnings.push({
        type: 'cites_review',
        severity: 'info',
        description:
          'Review CITES applicability for this HS code (Cap. 586 — Protection of Endangered Species).',
      });
    }

    // Rough diamonds (71.02)
    if (digits.startsWith('7102')) {
      warnings.push({
        type: 'kp_certificate',
        severity: 'block',
        description:
          'Rough diamond imports require a Kimberley Process certificate (Cap. 568, Import and Export Ordinance).',
      });
    }

    // Strategic commodities (broad coverage; defer to manual review).
    if (
      digits.startsWith('84') ||
      digits.startsWith('85') ||
      digits.startsWith('90')
    ) {
      warnings.push({
        type: 'strategic_commodity_review',
        severity: 'info',
        description:
          'Manual review for strategic commodities licensing (Cap. 60). Specific subheadings require ImpEx licenses.',
      });
    }

    // Rice (10.06)
    if (digits.startsWith('1006')) {
      warnings.push({
        type: 'reserved_commodity_rice',
        severity: 'warn',
        description:
          'Rice imports require Reserved Commodities Ordinance (Cap. 296) registration.',
      });
    }

    return warnings;
  }
}
