import {
  classifyProgramFamily,
  extractChapter99FromConditions,
  normalizeChapter99,
} from './program-family.helper';

describe('classifyProgramFamily', () => {
  describe('taxCode signal', () => {
    it('classifies Section 301 from a SECTION_301_* taxCode', () => {
      const r = classifyProgramFamily({
        componentType: 'section_301',
        identifier: 'SECTION_301_CN_LIST3',
      });
      expect(r.programFamily).toBe('section_301');
      expect(r.programAuthority).toMatch(/Section 301/);
      expect(r.reportingOrder).toBeLessThan(50);
    });

    it('classifies Section 232 from a SECTION_232_STEEL taxCode', () => {
      const r = classifyProgramFamily({
        componentType: 'section_232',
        identifier: 'SECTION_232_STEEL',
      });
      expect(r.programFamily).toBe('section_232');
    });

    it('classifies Section 201 / 421 / 122 distinctly', () => {
      expect(
        classifyProgramFamily({
          componentType: 'chapter_99',
          identifier: 'SECTION_201_SAFEGUARD',
        }).programFamily,
      ).toBe('section_201');
      expect(
        classifyProgramFamily({
          componentType: 'chapter_99',
          identifier: 'SECTION_421_SAFEGUARD_CN',
        }).programFamily,
      ).toBe('section_421');
      expect(
        classifyProgramFamily({
          componentType: 'section_122',
          identifier: 'SECTION_122_BALANCE_OF_PAYMENTS',
        }).programFamily,
      ).toBe('section_122');
    });

    it('classifies reciprocal before generic IEEPA', () => {
      const r = classifyProgramFamily({
        componentType: 'chapter_99',
        identifier: 'RECIP_BASELINE',
      });
      expect(r.programFamily).toBe('reciprocal');
    });

    it('classifies IEEPA when no reciprocal signal present', () => {
      const r = classifyProgramFamily({
        componentType: 'chapter_99',
        identifier: 'IEEPA_FENT_CN',
      });
      expect(r.programFamily).toBe('ieepa');
    });

    it('classifies quota / MTB / exclusion / replacement_duty', () => {
      expect(
        classifyProgramFamily({
          componentType: 'chapter_99',
          identifier: 'TRQ_QUOTA_STEEL_BR',
        }).programFamily,
      ).toBe('quota');
      expect(
        classifyProgramFamily({
          componentType: 'chapter_99',
          identifier: 'MTB_HR_4318',
        }).programFamily,
      ).toBe('mtb');
      expect(
        classifyProgramFamily({
          componentType: 'chapter_99',
          identifier: 'SECTION_301_EXCLUSION',
        }).programFamily,
      ).toBe('exclusion');
      expect(
        classifyProgramFamily({
          componentType: 'chapter_99',
          identifier: 'REPLACEMENT_DUTY_TR',
        }).programFamily,
      ).toBe('replacement_duty');
    });
  });

  describe('legalReference fallback', () => {
    it('uses Section 232 from a free-text legal reference', () => {
      const r = classifyProgramFamily({
        componentType: 'chapter_99',
        identifier: 'STEEL_ADD',
        legalReference: 'Section 232 of the Trade Expansion Act',
      });
      expect(r.programFamily).toBe('section_232');
    });

    it('classifies reciprocal from an EO 14257 reference', () => {
      const r = classifyProgramFamily({
        componentType: 'chapter_99',
        identifier: 'RC_BASELINE',
        legalReference: 'IEEPA EO 14257 — Reciprocal Tariff',
      });
      expect(r.programFamily).toBe('reciprocal');
    });
  });

  describe('Chapter 99 code heuristics', () => {
    it('infers Section 301 from a 9903.88.* code', () => {
      const r = classifyProgramFamily({
        componentType: 'chapter_99',
        chapter99Code: '9903.88.15',
      });
      expect(r.programFamily).toBe('section_301');
    });

    it('infers Section 232 from 9903.80.* / 9903.85.*', () => {
      expect(
        classifyProgramFamily({
          componentType: 'chapter_99',
          chapter99Code: '9903.80.01',
        }).programFamily,
      ).toBe('section_232');
      expect(
        classifyProgramFamily({
          componentType: 'chapter_99',
          chapter99Code: '9903.85.10',
        }).programFamily,
      ).toBe('section_232');
    });

    it('infers reciprocal from 9903.01.25/26/27 codes', () => {
      expect(
        classifyProgramFamily({
          componentType: 'chapter_99',
          chapter99Code: '9903.01.25',
        }).programFamily,
      ).toBe('reciprocal');
      expect(
        classifyProgramFamily({
          componentType: 'chapter_99',
          chapter99Code: '9903.01.26',
        }).programFamily,
      ).toBe('reciprocal');
    });

    it('infers Section 201 safeguard from 9903.45.*', () => {
      const r = classifyProgramFamily({
        componentType: 'chapter_99',
        chapter99Code: '9903.45.21',
      });
      expect(r.programFamily).toBe('section_201');
    });
  });

  describe('default behavior', () => {
    it('returns other_chapter_99 (NOT section_301) for unlabeled chapter_99 components', () => {
      // Regression: previously chapter_99 with no signal defaulted to
      // section_301, silently collapsing Section 201/421, MTB, IEEPA, quota,
      // etc. into the Section 301 bucket.
      const r = classifyProgramFamily({
        componentType: 'chapter_99',
        identifier: 'UNKNOWN_PROGRAM_X',
      });
      expect(r.programFamily).toBe('other_chapter_99');
    });

    it('mirrors stage type for fee / tax / base components', () => {
      expect(
        classifyProgramFamily({ componentType: 'mpf' }).programFamily,
      ).toBe('mpf');
      expect(
        classifyProgramFamily({ componentType: 'hmf' }).programFamily,
      ).toBe('hmf');
      expect(
        classifyProgramFamily({ componentType: 'post_tax' }).programFamily,
      ).toBe('tax');
      expect(
        classifyProgramFamily({ componentType: 'base' }).programFamily,
      ).toBe('base');
      expect(
        classifyProgramFamily({ componentType: 'special' }).programFamily,
      ).toBe('special');
      expect(
        classifyProgramFamily({ componentType: 'non_ntr' }).programFamily,
      ).toBe('non_ntr');
    });

    it('always populates programAuthority and a reportingOrder weight', () => {
      const r = classifyProgramFamily({
        componentType: 'chapter_99',
        identifier: 'UNKNOWN',
      });
      expect(r.programAuthority).toBeTruthy();
      expect(typeof r.reportingOrder).toBe('number');
    });
  });

  describe('reporting order', () => {
    it('orders Section 232 before Section 301 (CBP ACE ordering)', () => {
      const a = classifyProgramFamily({ componentType: 'section_232' });
      const b = classifyProgramFamily({ componentType: 'section_301' });
      expect(a.reportingOrder).toBeLessThan(b.reportingOrder);
    });

    it('orders Chapter 98 before any Chapter 99 derivative', () => {
      const ch98 = classifyProgramFamily({ componentType: 'chapter_98' });
      const others: Array<Parameters<typeof classifyProgramFamily>[0]> = [
        { componentType: 'section_301' },
        { componentType: 'chapter_99', identifier: 'RECIP_X' },
        { componentType: 'chapter_99' },
      ];
      for (const arg of others) {
        expect(ch98.reportingOrder).toBeLessThan(
          classifyProgramFamily(arg).reportingOrder,
        );
      }
    });

    it('orders base/special/non_ntr after all Chapter 99 families', () => {
      const base = classifyProgramFamily({ componentType: 'base' });
      const ch99 = classifyProgramFamily({ componentType: 'chapter_99' });
      expect(ch99.reportingOrder).toBeLessThan(base.reportingOrder);
    });
  });
});

describe('extractChapter99FromConditions', () => {
  it('returns null for null/empty conditions', () => {
    expect(extractChapter99FromConditions(null)).toBeNull();
    expect(extractChapter99FromConditions(undefined)).toBeNull();
    expect(extractChapter99FromConditions({})).toBeNull();
  });

  it('extracts from htsHeading', () => {
    expect(
      extractChapter99FromConditions({ htsHeading: '9903.88.15' }),
    ).toBe('9903.88.15');
  });

  it('extracts from chapter99Heading', () => {
    expect(
      extractChapter99FromConditions({ chapter99Heading: '9903.01.25' }),
    ).toBe('9903.01.25');
  });

  it('extracts from exceptionHeading (used for reciprocal exemptions)', () => {
    expect(
      extractChapter99FromConditions({ exceptionHeading: '9903.01.26' }),
    ).toBe('9903.01.26');
  });

  it('returns null for a non-Chapter-99 heading string', () => {
    expect(
      extractChapter99FromConditions({ htsHeading: '6109.10.00.04' }),
    ).toBeNull();
  });
});

describe('normalizeChapter99', () => {
  it('passes through dotted 8-digit form', () => {
    expect(normalizeChapter99('9903.88.15')).toBe('9903.88.15');
  });

  it('passes through dotted 10-digit form', () => {
    expect(normalizeChapter99('9903.88.15.00')).toBe('9903.88.15.00');
  });

  it('formats a raw 8-digit string', () => {
    expect(normalizeChapter99('99038815')).toBe('9903.88.15');
  });

  it('formats a raw 10-digit string', () => {
    expect(normalizeChapter99('9903881500')).toBe('9903.88.15.00');
  });

  it('returns null for non-Chapter-99 values', () => {
    expect(normalizeChapter99('6109.10.00.04')).toBeNull();
    expect(normalizeChapter99('not-a-code')).toBeNull();
    expect(normalizeChapter99(null)).toBeNull();
    expect(normalizeChapter99('')).toBeNull();
  });
});
