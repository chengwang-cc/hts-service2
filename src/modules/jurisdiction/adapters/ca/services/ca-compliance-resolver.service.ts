import { Injectable } from '@nestjs/common';

export interface CaControlWarning {
  type: string;
  severity: 'block' | 'warn' | 'info';
  description: string;
}

/**
 * CaComplianceResolverService — surface CBSA / OGD warnings keyed by
 * HS prefix. Real-world enforcement is far richer (CFIA, Transport
 * Canada, Health Canada, Global Affairs, NRCan...); this is a starter
 * heuristic until ControlEntity rows are seeded.
 */
@Injectable()
export class CaComplianceResolverService {
  resolve(hsCode: string): CaControlWarning[] {
    const digits = (hsCode || '').replace(/\D/g, '');
    const out: CaControlWarning[] = [];
    if (!digits) return out;

    // Food + agriculture (CFIA)
    if (
      digits.startsWith('02') ||
      digits.startsWith('03') ||
      digits.startsWith('04') ||
      digits.startsWith('07') ||
      digits.startsWith('08')
    ) {
      out.push({
        type: 'cfia_inspection',
        severity: 'warn',
        description:
          'CFIA inspection / SFC license likely required for food, plant, or animal imports.',
      });
    }

    // Health products (Health Canada)
    if (digits.startsWith('30') || digits.startsWith('33')) {
      out.push({
        type: 'health_canada_license',
        severity: 'warn',
        description:
          'Pharmaceutical / cosmetic products require Health Canada licensing or notification.',
      });
    }

    // Firearms / ammunition (RCMP, Global Affairs)
    if (digits.startsWith('93')) {
      out.push({
        type: 'firearms_permit',
        severity: 'block',
        description:
          'Firearms / ammunition require an RCMP authorization and Global Affairs import permit.',
      });
    }

    // CITES
    if (digits.startsWith('01') || digits.startsWith('05')) {
      out.push({
        type: 'cites_review',
        severity: 'info',
        description: 'Review CITES applicability for live animals / animal products.',
      });
    }

    return out;
  }
}
