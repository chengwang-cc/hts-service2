import { Injectable } from '@nestjs/common';
import {
  FormulaVariable,
  SourceCitationRef,
  TariffApplyCondition,
  TariffComponentType,
  TariffFormulaComponent,
} from '../../../../calculator/services/tariff-types';
import { GbCommodityResponse } from './gb-trade-tariff-ingestion.service';

/**
 * GbMeasureNormalizerService (P5.1)
 *
 * Translates GOV.UK Trade Tariff measure rows into the platform's
 * componentized TariffFormulaComponent shape. Recognises the common
 * ad-valorem (e.g. "12.00 %"), specific (e.g. "32.50 GBP / 100 kg"),
 * and "Free" formats, and labels anti-dumping / countervailing /
 * additional-code measures distinctly so the resolver can surface them.
 */
@Injectable()
export class GbMeasureNormalizerService {
  normalize(commodity: GbCommodityResponse, originCountry: string): {
    components: TariffFormulaComponent[];
    warnings: string[];
    rawMeasures: number;
  } {
    const out: TariffFormulaComponent[] = [];
    const warnings: string[] = [];
    const origin = (originCountry || '').toUpperCase();

    for (const m of commodity.importMeasures || []) {
      // Filter out measures that explicitly do NOT apply to this origin.
      // GOV.UK geographical_area_id can be a country (ISO 3166-1 alpha-2),
      // an EU code, "ERGA OMNES" etc. We accept ERGA OMNES + origin match.
      const area = (m.geographicalAreaId || '').toUpperCase();
      if (area && area !== 'ERGA OMNES' && area !== '1011' && area !== origin) {
        // Most likely this measure is country-targeted to a different country.
        continue;
      }

      const componentType = this.classifyMeasureType(m.measureTypeId);
      const dutyText =
        m.dutyExpressionFormatted ||
        m.dutyExpressionFormattedBase ||
        m.dutyExpressionAbbreviation ||
        '';
      const formula = this.toFormula(dutyText);

      if (!formula) {
        warnings.push(
          `Unparseable GB measure ${m.measureTypeId}: "${dutyText}" (skipped)`,
        );
        continue;
      }

      const citation: SourceCitationRef = {
        source: 'GOV.UK Trade Tariff',
        url: `https://www.trade-tariff.service.gov.uk/uk/api/v2/commodities/${commodity.code}`,
        rowIdentifier: `${commodity.code}|measure:${m.measureTypeId}|origin:${origin || 'ERGA OMNES'}`,
        confidence: 0.9,
        parserMethod: 'gb_trade_tariff_api',
        effectiveDate: m.effectiveStartDate,
      };

      const appliesWhen: TariffApplyCondition =
        area && area !== 'ERGA OMNES'
          ? { kind: 'country_in', countries: [area] }
          : { kind: 'always' };

      out.push({
        componentType,
        formula,
        rateText: dutyText,
        identifier: m.measureTypeId,
        description: m.measureTypeDescription || componentType,
        requiredVariables: this.deriveVars(formula),
        appliesWhen,
        confidence: 0.9,
        sourceCitation: citation,
      });
    }

    return { components: out, warnings, rawMeasures: commodity.importMeasures?.length || 0 };
  }

  private classifyMeasureType(measureTypeId: string): TariffComponentType {
    // GOV.UK measure type IDs documented at
    // https://hub.trade-tariff.service.gov.uk/documentation/.
    //  103 = Third country duty
    //  142 = Tariff preference
    //  145 = Customs duty (national)
    //  551 = Authorised use duty exemption
    //  552 = Authorised use duty reduction
    //  119 = Anti-dumping
    //  113 = Countervailing
    //  122 = Suspension
    //  123 = Quota
    //  306 = VAT — handled by GbVatRuleResolver, not here.
    const id = (measureTypeId || '').toUpperCase();
    if (id === '142' || id === '146') return 'special';
    if (id === '119' || id === '113') return 'section_301'; // closest analogue
    if (id === '122') return 'special';
    if (id === '306') return 'post_tax';
    return 'base';
  }

  private toFormula(dutyText: string): string | null {
    const t = (dutyText || '').trim();
    if (!t || /^free$/i.test(t)) return '0';

    // Compound FIRST: "12.00 % + 32.50 GBP / 100 kg" — otherwise the
    // ad-valorem matcher would consume the first half and discard the rest.
    if (/\+/.test(t)) {
      const parts = t.split('+').map((p) => p.trim());
      const sub = parts
        .map((p) => this.toAtomicFormula(p))
        .filter((p): p is string => !!p);
      if (sub.length > 0) return sub.join(' + ');
    }

    return this.toAtomicFormula(t);
  }

  private toAtomicFormula(text: string): string | null {
    const t = text.trim();
    if (!t || /^free$/i.test(t)) return '0';

    // Ad valorem: "12.00 %" anchored.
    const pct = t.match(/^(\d+(?:\.\d+)?)\s*%/);
    if (pct) return `value * ${parseFloat(pct[1]) / 100}`;

    // Specific: "32.50 GBP / 100 kg" anchored.
    const specific = t.match(
      /^(\d+(?:\.\d+)?)\s*(GBP|EUR|USD)\s*\/?\s*(\d+)?\s*(kg|l|piece|head|pair)?/i,
    );
    if (specific) {
      const amount = parseFloat(specific[1]);
      const unitDivisor = specific[3] ? parseFloat(specific[3]) : 1;
      const unit = (specific[4] || 'kg').toLowerCase();
      const variable =
        unit === 'kg' ? 'weight' : unit === 'l' ? 'volume_liters' : 'quantity';
      const rate = amount / Math.max(unitDivisor, 1);
      return `${variable} * ${rate}`;
    }

    return null;
  }

  private deriveVars(formula: string): FormulaVariable[] {
    const names = new Set<string>();
    const re = /\b(value|weight|quantity|volume_liters|alcohol_strength)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(formula)) !== null) names.add(m[1]);
    return Array.from(names).map((name) => ({
      name,
      type: 'number',
      description:
        name === 'value'
          ? 'Declared value (GBP)'
          : name === 'weight'
            ? 'Weight (kg)'
            : name === 'quantity'
              ? 'Quantity (units)'
              : name === 'volume_liters'
                ? 'Volume (liters)'
                : 'Alcohol strength (%)',
    }));
  }
}
