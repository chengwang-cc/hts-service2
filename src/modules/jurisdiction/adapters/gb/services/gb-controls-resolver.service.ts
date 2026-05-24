import { Injectable } from '@nestjs/common';
import { GbCommodityResponse } from './gb-trade-tariff-ingestion.service';

export interface GbControlWarning {
  type: string;
  severity: 'block' | 'warn' | 'info';
  description: string;
}

/**
 * GbControlsResolverService (P5.1)
 *
 * Walks a commodity's measures and surfaces controls / quotas /
 * anti-dumping measures as warnings. The actual rate handling lives in
 * GbMeasureNormalizer (those rows become tariff components); this
 * resolver returns the human-readable advisories that the quote-line
 * `controls` field carries.
 */
@Injectable()
export class GbControlsResolverService {
  resolve(commodity: GbCommodityResponse): GbControlWarning[] {
    const out: GbControlWarning[] = [];

    for (const m of commodity.importMeasures || []) {
      const id = (m.measureTypeId || '').toUpperCase();
      const desc = m.measureTypeDescription || id;

      // 277/278 — Licensing requirements (block).
      if (id === '277' || id === '278') {
        out.push({
          type: 'license_required',
          severity: 'block',
          description: `${desc} — import license required by HMRC.`,
        });
      }
      // 705 — Restriction (block).
      if (id === '705') {
        out.push({
          type: 'restricted_goods',
          severity: 'block',
          description: `${desc} — restricted goods.`,
        });
      }
      // 706 — Prohibition (block).
      if (id === '706') {
        out.push({
          type: 'prohibited_goods',
          severity: 'block',
          description: `${desc} — prohibited goods.`,
        });
      }
      // 410 — Surveillance (info).
      if (id === '410') {
        out.push({
          type: 'surveillance',
          severity: 'info',
          description: `${desc} — surveillance measure (informational).`,
        });
      }
      // 123 — Tariff quota (warn).
      if (id === '123') {
        out.push({
          type: 'tariff_quota',
          severity: 'warn',
          description: `${desc} — quota measure; quota balance not validated.`,
        });
      }
      // 119 / 113 — Anti-dumping / Countervailing (warn).
      if (id === '119' || id === '113') {
        out.push({
          type: id === '119' ? 'anti_dumping' : 'countervailing',
          severity: 'warn',
          description: `${desc} — additional duty applies; verify origin documentation.`,
        });
      }
    }

    return out;
  }
}
