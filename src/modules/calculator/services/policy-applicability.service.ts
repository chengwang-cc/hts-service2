import { Injectable } from '@nestjs/common';

@Injectable()
export class PolicyApplicabilityService {
  static readonly RECIPROCAL_BASELINE_EFFECTIVE = new Date(
    Date.UTC(2025, 3, 5),
  );

  private static readonly RECIPROCAL_COUNTRY_EXCEPTIONS: Record<
    string,
    string
  > = {
    CA: '9903.01.26',
    MX: '9903.01.27',
  };

  private static readonly RECIPROCAL_BASELINE_HEADING = '9903.01.25';

  applySystemChapter99Selections(args: {
    additionalInputs?: Record<string, any>;
    countryOfOrigin: string;
    calculationDate: Date;
  }): {
    additionalInputs: Record<string, any>;
    selectedChapter99Headings: string[];
    systemSelectedChapter99Headings: string[];
  } {
    const inputs = args.additionalInputs ? { ...args.additionalInputs } : {};
    const existing = this.extractSelectedChapter99Headings(inputs);
    const systemSelected: string[] = [];

    if (
      !this.isTruthyFlag(inputs.skipReciprocalBaseline) &&
      args.calculationDate.getTime() >=
        PolicyApplicabilityService.RECIPROCAL_BASELINE_EFFECTIVE.getTime()
    ) {
      const country = (args.countryOfOrigin || '').toUpperCase();
      const auto =
        PolicyApplicabilityService.RECIPROCAL_COUNTRY_EXCEPTIONS[country] ??
        PolicyApplicabilityService.RECIPROCAL_BASELINE_HEADING;
      const normalizedAuto = this.normalizeChapter99Heading(auto);
      if (normalizedAuto && !existing.has(normalizedAuto)) {
        existing.add(normalizedAuto);
        systemSelected.push(normalizedAuto);
      }
    }

    inputs.chapter99Headings = Array.from(existing);

    return {
      additionalInputs: inputs,
      selectedChapter99Headings: Array.from(existing),
      systemSelectedChapter99Headings: systemSelected,
    };
  }

  extractSelectedChapter99Headings(
    additionalInputs?: Record<string, any>,
  ): Set<string> {
    const headings = new Set<string>();
    if (!additionalInputs || typeof additionalInputs !== 'object') {
      return headings;
    }

    const directCandidates = [
      additionalInputs.chapter99Heading,
      additionalInputs.selectedChapter99Heading,
      additionalInputs.chapter99Code,
      additionalInputs.chapter99Hts,
    ];
    for (const candidate of directCandidates) {
      const normalized = this.normalizeChapter99Heading(
        typeof candidate === 'string' ? candidate : null,
      );
      if (normalized) headings.add(normalized);
    }

    const arrayCandidates = [
      additionalInputs.chapter99Headings,
      additionalInputs.selectedChapter99Headings,
    ];
    for (const values of arrayCandidates) {
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        const normalized = this.normalizeChapter99Heading(
          typeof value === 'string' ? value : null,
        );
        if (normalized) headings.add(normalized);
      }
    }

    const mapCandidates = [
      additionalInputs.chapter99Selections,
      additionalInputs.FIELD_CHOSEN_HTS_CODES,
    ];
    for (const mapValue of mapCandidates) {
      if (
        !mapValue ||
        typeof mapValue !== 'object' ||
        Array.isArray(mapValue)
      ) {
        continue;
      }
      for (const [rawCode, enabled] of Object.entries(mapValue)) {
        if (!this.isTruthyFlag(enabled)) continue;
        const normalized = this.normalizeChapter99Heading(rawCode);
        if (normalized) headings.add(normalized);
      }
    }

    return headings;
  }

  normalizeChapter99Heading(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (/^99\d{2}\.\d{2}\.\d{2}(?:\.\d{2})?$/.test(trimmed)) {
      return trimmed;
    }

    const digits = trimmed.replace(/[^0-9]/g, '');
    if (/^99\d{6}$/.test(digits)) {
      return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
    }
    if (/^99\d{8}$/.test(digits)) {
      return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}.${digits.slice(8, 10)}`;
    }

    return null;
  }

  isTruthyFlag(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      return ['1', 'true', 'yes', 'y', 'on'].includes(
        value.trim().toLowerCase(),
      );
    }
    return false;
  }
}
