import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsEntity } from '@hts/core';

export type RateClass =
  | 'free'
  | 'pct'
  | 'specific'
  | 'compound'
  | 'ch99'
  | 'non_ntr'
  | 'unknown';

export interface CorpusRow {
  htsNumber: string;
  chapter: string;
  heading: string | null;
  rateClass: RateClass;
  countryOfOrigin: string;
  declaredValue: number;
  inputs: Record<string, number>;
}

export interface CorpusFilter {
  /** Two-digit chapter codes to include; default = all (01–99 active). */
  chapters?: string[];
  /** ISO-2 country list to expand each HTS against. Default: ['CN','MX','CA','DE','KR','RU']. */
  countries?: string[];
  /** USD declared values to test each (HTS, country) at. Default: [50, 1000, 50000]. */
  valueBands?: number[];
  /** Subheadings per heading to sample (per rate-class bucket). Default: 3. */
  perHeading?: number;
}

const DEFAULT_COUNTRIES = ['CN', 'MX', 'CA', 'DE', 'KR', 'RU'];
const DEFAULT_VALUE_BANDS = [50, 1000, 50_000];
const DEFAULT_PER_HEADING = 3;
const NON_NTR_DEFAULT = new Set(['CU', 'KP', 'BY', 'RU']);

/**
 * ParityCorpusService
 *
 * Selects a representative sample of HTS subheadings for parity sweeps.
 * The shape we produce: ~3 subheadings per heading per chapter, expanded
 * across a country matrix and a value-band matrix, classified by
 * rate-class so we exercise every formula shape.
 */
@Injectable()
export class ParityCorpusService {
  private readonly logger = new Logger(ParityCorpusService.name);

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepo: Repository<HtsEntity>,
  ) {}

  classifyRateText(generalRate: string | null | undefined, htsNumber: string): RateClass {
    if (htsNumber?.startsWith('99')) return 'ch99';
    const t = (generalRate || '').trim().toLowerCase();
    if (!t) return 'unknown';
    if (/^free$/i.test(t) || /^0%?$/.test(t)) return 'free';
    const hasPct = /%/.test(t);
    const hasSpecific = /(\$|¢|cent)|\/\s*(kg|lb|liter|gal|doz|pair|head|piece|pc|unit)/i.test(t);
    if (hasPct && hasSpecific) return 'compound';
    if (hasPct) return 'pct';
    if (hasSpecific) return 'specific';
    return 'unknown';
  }

  async selectCorpus(filter: CorpusFilter = {}): Promise<CorpusRow[]> {
    const countries = (filter.countries && filter.countries.length > 0)
      ? filter.countries
      : DEFAULT_COUNTRIES;
    const valueBands =
      filter.valueBands && filter.valueBands.length > 0
        ? filter.valueBands
        : DEFAULT_VALUE_BANDS;
    const perHeading = filter.perHeading ?? DEFAULT_PER_HEADING;

    const qb = this.htsRepo
      .createQueryBuilder('hts')
      .select([
        'hts.htsNumber',
        'hts.chapter',
        'hts.heading',
        'hts.generalRate',
        'hts.rateFormula',
        'hts.otherRate',
        'hts.adjustedFormula',
      ])
      .where('hts.isActive = true')
      .andWhere('hts.indent = :leaf', { leaf: 2 })
      .andWhere('hts.rateFormula IS NOT NULL');

    if (filter.chapters && filter.chapters.length > 0) {
      qb.andWhere('hts.chapter IN (:...chapters)', {
        chapters: filter.chapters,
      });
    }

    qb.orderBy('hts.chapter', 'ASC')
      .addOrderBy('hts.heading', 'ASC')
      .addOrderBy('hts.htsNumber', 'ASC')
      .limit(50000); // hard cap so a misconfigured filter can't OOM

    const rows = await qb.getMany();
    this.logger.log(`Corpus query returned ${rows.length} candidate HTS rows`);

    // Bucket by (chapter, heading, rateClass); take up to `perHeading` per
    // (heading, rateClass) — yields at most `perHeading * #rateClasses`
    // subheadings per heading.
    type BucketKey = string; // `${chapter}|${heading}|${rateClass}`
    const buckets = new Map<BucketKey, HtsEntity[]>();
    for (const r of rows) {
      const klass = this.classifyRateText(r.generalRate, r.htsNumber);
      const key = `${r.chapter}|${r.heading ?? ''}|${klass}`;
      const arr = buckets.get(key) ?? [];
      if (arr.length < perHeading) {
        arr.push(r);
        buckets.set(key, arr);
      }
    }

    // Expand picked HTS rows across countries × valueBands.
    const corpus: CorpusRow[] = [];
    for (const [, picked] of buckets) {
      for (const hts of picked) {
        const klass = this.classifyRateText(hts.generalRate, hts.htsNumber);
        for (const country of countries) {
          const upper = country.toUpperCase();
          // Override rate-class label to 'non_ntr' when country falls under
          // the non-NTR list — same row, different expected formula path.
          const effectiveClass: RateClass = NON_NTR_DEFAULT.has(upper)
            ? 'non_ntr'
            : klass;
          for (const value of valueBands) {
            corpus.push({
              htsNumber: hts.htsNumber,
              chapter: hts.chapter,
              heading: hts.heading,
              rateClass: effectiveClass,
              countryOfOrigin: upper,
              declaredValue: value,
              inputs: { value },
            });
          }
        }
      }
    }

    this.logger.log(
      `Corpus expansion: ${corpus.length} rows from ${buckets.size} buckets ` +
        `× ${countries.length} countries × ${valueBands.length} value bands`,
    );
    return corpus;
  }

  /**
   * Convenience helper: corpus size estimator for the run header without
   * materialising rows. Used by the admin "start a run" preview.
   */
  async estimateCorpusSize(filter: CorpusFilter = {}): Promise<number> {
    const countries = filter.countries?.length ?? DEFAULT_COUNTRIES.length;
    const valueBands = filter.valueBands?.length ?? DEFAULT_VALUE_BANDS.length;
    const perHeading = filter.perHeading ?? DEFAULT_PER_HEADING;
    const rateClasses = 5; // free / pct / specific / compound / unknown
    // Heading count from DB.
    const qb = this.htsRepo
      .createQueryBuilder('hts')
      .select('COUNT(DISTINCT hts.heading)', 'cnt')
      .where('hts.isActive = true')
      .andWhere('hts.heading IS NOT NULL');
    if (filter.chapters && filter.chapters.length > 0) {
      qb.andWhere('hts.chapter IN (:...chapters)', {
        chapters: filter.chapters,
      });
    }
    const row = await qb.getRawOne<{ cnt: string }>();
    const headings = Number(row?.cnt ?? 0);
    return Math.min(
      headings * perHeading * rateClasses * countries * valueBands,
      50_000 * valueBands * countries,
    );
  }
}
