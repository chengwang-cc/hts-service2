/**
 * Program-family helpers.
 *
 * Calculator-runtime classification of a component's policy/legal family.
 * Independent of `componentType` (which is the calculation stage —
 * base/special/extra/post). Used by the UI to render a stable program label
 * and legal authority for each duty/fee line so users can audit "why was
 * this applied?" without leaving the calculator.
 *
 * `componentType` describes the calc stage. `programFamily` describes the
 * legal family on which the rule is based. The two are independent — for
 * example a row may be `componentType: 'chapter_99'` with `programFamily:
 * 'reciprocal'` (IEEPA reciprocal baseline) or `componentType: 'section_301'`
 * with `programFamily: 'section_301'`.
 */

import type { ProgramFamily, TariffComponentType } from './tariff-types';

export interface ProgramFamilyClassification {
  programFamily: ProgramFamily;
  programAuthority: string;
  /** Federal Register / statute citation surface, when known. */
  legalReference?: string;
  /** Reporting order weight per CBP ACE (lower comes first). */
  reportingOrder: number;
}

/** Reporting order per CBP ACE guidance for multi-HTS entry lines. */
const REPORTING_ORDER: Record<ProgramFamily, number> = {
  chapter_98: 10,
  section_232: 20,
  section_201: 21,
  section_421: 22,
  section_301: 25,
  ieepa: 28,
  reciprocal: 29,
  section_122: 30,
  replacement_duty: 35,
  quota: 40,
  mtb: 45,
  temporary_duty_suspension: 46,
  exclusion: 47,
  other_chapter_99: 50,
  base: 60,
  special: 61,
  non_ntr: 62,
  mpf: 80,
  hmf: 81,
  tax: 90,
};

const PROGRAM_AUTHORITY: Record<ProgramFamily, string> = {
  base: 'HTS Chapter 1-97',
  special: 'HTS Special Program Indicator',
  non_ntr: 'HTS Column 2 (Non-NTR)',
  chapter_98: 'HTS Chapter 98',
  section_301: 'Section 301 of the Trade Act of 1974',
  section_232: 'Section 232 of the Trade Expansion Act of 1962',
  section_201: 'Section 201 of the Trade Act of 1974',
  section_421: 'Section 421 of the Trade Act of 1974',
  section_122: 'Section 122 of the Trade Act of 1974',
  ieepa: 'International Emergency Economic Powers Act',
  reciprocal: 'IEEPA Reciprocal Tariff (EO 14257)',
  quota: 'Tariff-rate quota / absolute quota',
  mtb: 'Miscellaneous Tariff Bill',
  temporary_duty_suspension: 'Temporary duty suspension (Chapter 99)',
  replacement_duty: 'Replacement duty (Chapter 99)',
  exclusion: 'Chapter 99 exclusion',
  mpf: 'Customs User Fee (19 CFR 24.23) — MPF',
  hmf: 'Harbor Maintenance Fee (26 USC 4461)',
  tax: 'Internal revenue tax',
  other_chapter_99: 'HTS Chapter 99 (other)',
};

/**
 * Classify a calculator component into a stable program family.
 *
 * Inputs:
 *   componentType  — calculation stage (base/special/chapter_99/section_301/…)
 *   identifier     — taxCode / row identifier (e.g. SECTION_301_CN_LIST3, IEEPA_RECIP_CN)
 *   legalReference — free-text legal reference column (e.g. "Section 232")
 *   chapter99Code  — normalized Chapter 99 HTS code if known (e.g. "9903.88.15")
 */
export function classifyProgramFamily(args: {
  componentType: TariffComponentType;
  identifier?: string | null;
  legalReference?: string | null;
  chapter99Code?: string | null;
}): ProgramFamilyClassification {
  const id = (args.identifier || '').toUpperCase();
  const ref = (args.legalReference || '').toUpperCase();
  const code = (args.chapter99Code || '').replace(/\s+/g, '');

  // Direct, high-confidence signals from taxCode / legalReference.
  //
  // Exclusions are checked first because an exclusion code often names the
  // program it exempts (e.g. SECTION_301_EXCLUSION_LIST3). Classifying it
  // as the parent program would hide the fact that the row REMOVES rather
  // than ADDS duty.
  if (
    id.includes('EXCLUSION') ||
    ref.includes('EXCLUSION') ||
    code.startsWith('9903.88.6') ||
    code.startsWith('9903.88.7')
  ) {
    return finalize('exclusion', args.legalReference);
  }
  if (id.startsWith('SECTION_301') || ref.includes('SECTION 301')) {
    return finalize('section_301', args.legalReference);
  }
  if (id.startsWith('SECTION_232') || ref.includes('SECTION 232')) {
    return finalize('section_232', args.legalReference);
  }
  if (id.startsWith('SECTION_201') || ref.includes('SECTION 201')) {
    return finalize('section_201', args.legalReference);
  }
  if (id.startsWith('SECTION_421') || ref.includes('SECTION 421')) {
    return finalize('section_421', args.legalReference);
  }
  if (id.startsWith('SECTION_122') || ref.includes('SECTION 122')) {
    return finalize('section_122', args.legalReference);
  }
  if (
    id.startsWith('RECIP_') ||
    id.includes('RECIPROCAL') ||
    ref.includes('RECIPROCAL') ||
    ref.includes('EO 14257') ||
    ref.includes('EO14257')
  ) {
    return finalize('reciprocal', args.legalReference);
  }
  if (id.startsWith('IEEPA') || ref.includes('IEEPA')) {
    return finalize('ieepa', args.legalReference);
  }
  if (id.includes('QUOTA') || ref.includes('QUOTA')) {
    return finalize('quota', args.legalReference);
  }
  if (id.startsWith('MTB') || ref.includes('MISCELLANEOUS TARIFF BILL')) {
    return finalize('mtb', args.legalReference);
  }
  if (
    id.includes('SUSPENSION') ||
    id.includes('TEMPORARY') ||
    ref.includes('TEMPORARY DUTY SUSPENSION')
  ) {
    return finalize('temporary_duty_suspension', args.legalReference);
  }
  if (id.includes('REPLACEMENT') || ref.includes('REPLACEMENT DUTY')) {
    return finalize('replacement_duty', args.legalReference);
  }

  // Signals from the Chapter 99 number prefix. Coverage is partial — these
  // are heuristics for unlabeled rows. Where the legalReference is known we
  // never reach this branch.
  if (code.startsWith('9903.88')) {
    return finalize('section_301', args.legalReference);
  }
  if (
    code.startsWith('9903.80') ||
    code.startsWith('9903.81') ||
    code.startsWith('9903.85')
  ) {
    return finalize('section_232', args.legalReference);
  }
  if (
    code.startsWith('9903.01.25') ||
    code.startsWith('9903.01.26') ||
    code.startsWith('9903.01.27')
  ) {
    return finalize('reciprocal', args.legalReference);
  }
  if (code.startsWith('9903.01')) {
    return finalize('ieepa', args.legalReference);
  }
  if (code.startsWith('9903.45')) {
    return finalize('section_201', args.legalReference);
  }

  // Fall back to componentType-derived family. Critically: an unlabeled
  // `chapter_99`/extra row that does not match anything above is classified
  // as `other_chapter_99` rather than silently being collapsed to
  // `section_301`.
  switch (args.componentType) {
    case 'base':
      return finalize('base', args.legalReference);
    case 'special':
      return finalize('special', args.legalReference);
    case 'non_ntr':
      return finalize('non_ntr', args.legalReference);
    case 'chapter_98':
      return finalize('chapter_98', args.legalReference);
    case 'section_301':
      return finalize('section_301', args.legalReference);
    case 'section_232':
      return finalize('section_232', args.legalReference);
    case 'section_122':
      return finalize('section_122', args.legalReference);
    case 'mpf':
      return finalize('mpf', args.legalReference);
    case 'hmf':
      return finalize('hmf', args.legalReference);
    case 'post_tax':
      return finalize('tax', args.legalReference);
    case 'chapter_99':
    default:
      return finalize('other_chapter_99', args.legalReference);
  }
}

/**
 * Pick a Chapter 99 HTS code out of a conditions blob. Supports the shapes
 * used by hts_extra_taxes rows (`htsHeading`, `exceptionHeading`,
 * `chapter99Heading`).
 */
export function extractChapter99FromConditions(
  conditions: Record<string, unknown> | null | undefined,
): string | null {
  if (!conditions || typeof conditions !== 'object') return null;
  const candidates = [
    conditions['htsHeading'],
    conditions['chapter99Heading'],
    conditions['exceptionHeading'],
    conditions['heading'],
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const normalized = normalizeChapter99(candidate);
      if (normalized) return normalized;
    }
  }
  return null;
}

/** Normalize a free-text Chapter 99 number to dotted 8/10-digit form. */
export function normalizeChapter99(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^99\d{2}\.\d{2}\.\d{2}(?:\.\d{2})?$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (/^99\d{6}$/.test(digits)) {
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
  }
  if (/^99\d{8}$/.test(digits)) {
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}.${digits.slice(8, 10)}`;
  }
  return null;
}

function finalize(
  family: ProgramFamily,
  legalReference?: string | null,
): ProgramFamilyClassification {
  return {
    programFamily: family,
    programAuthority: PROGRAM_AUTHORITY[family],
    legalReference: legalReference || undefined,
    reportingOrder: REPORTING_ORDER[family],
  };
}
