import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsEntity, HtsFormulaUpdateService } from '@hts/core';
import { NoteResolutionService } from '@hts/knowledgebase';

@Injectable()
export class RateRetrievalService {
  private readonly logger = new Logger(RateRetrievalService.name);

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
    private readonly formulaUpdateService: HtsFormulaUpdateService,
    @Optional() private readonly noteResolutionService?: NoteResolutionService,
  ) {
    if (this.noteResolutionService) {
      this.logger.log('Knowledgebase integration enabled for rate retrieval');
    } else {
      this.logger.log('Running without knowledgebase - using fallback strategy');
    }
  }

  async getRate(
    htsNumber: string,
    countryOfOrigin: string,
    version?: string,
  ): Promise<{
    formula: string;
    source: 'manual' | 'knowledgebase' | 'general' | 'other' | 'adjusted';
    confidence: number;
    overrideExtraTax?: boolean;
    formulaType?: string;
    variables?: Array<{ name: string; type: string; description?: string; unit?: string }> | null;
  }> {
    const normalizedCountry = countryOfOrigin.toUpperCase();

    // Load HTS entry to determine version and base formulas
    const htsEntry = await this.loadBestMatchingEntry(htsNumber, version);

    if (!htsEntry) {
      throw new Error(`HTS code ${htsNumber} not found`);
    }

    const resolvedVersion =
      version || (htsEntry as any).version || htsEntry.sourceVersion || null;

    const nonNtrCountries = this.resolveNonNtrCountries(htsEntry);
    const isNonNTR = nonNtrCountries.includes(normalizedCountry);
    const chapter99Countries = (htsEntry.chapter99ApplicableCountries || []).map((code) =>
      code.toUpperCase(),
    );
    const chapter99Applies =
      !isNonNTR &&
      chapter99Countries.includes(normalizedCountry) &&
      !!htsEntry.adjustedFormula;
    const otherChapter99Applies =
      isNonNTR &&
      !!htsEntry.otherChapter99Detail?.formula &&
      (
        !htsEntry.otherChapter99Detail?.countries ||
        htsEntry.otherChapter99Detail.countries.length === 0 ||
        htsEntry.otherChapter99Detail.countries
          .map((code) => code.toUpperCase())
          .includes(normalizedCountry)
      );

    const desiredFormulaType = otherChapter99Applies
      ? 'OTHER_CHAPTER99'
      : isNonNTR
        ? 'OTHER'
        : chapter99Applies
          ? 'ADJUSTED'
          : 'GENERAL';

    // Priority 1: Manual override (version + country + type aware)
    for (const formulaType of this.getManualFormulaLookupOrder(desiredFormulaType)) {
      const manualOverride = await this.formulaUpdateService.findUpdatedFormula({
        htsNumber,
        countryCode: normalizedCountry,
        formulaType,
        version: resolvedVersion,
      });

      if (manualOverride) {
        this.logger.debug(`Using manual override for ${htsNumber} (${formulaType})`);
        return {
          formula: manualOverride.formula,
          source: 'manual',
          confidence: 1.0,
          overrideExtraTax: manualOverride.overrideExtraTax,
          formulaType: manualOverride.formulaType,
          variables: manualOverride.formulaVariables ?? null,
        };
      }
    }

    // Priority 2: Standard HTS formulas
    if (otherChapter99Applies && htsEntry.otherChapter99Detail?.formula) {
      this.logger.debug(`Using non-NTR + Chapter99 formula for ${htsNumber}`);
      return {
        formula: htsEntry.otherChapter99Detail.formula,
        source: 'other',
        confidence: 0.95,
        formulaType: 'OTHER_CHAPTER99',
        variables: htsEntry.otherChapter99Detail.variables || null,
      };
    }

    if (isNonNTR && htsEntry.otherRateFormula) {
      this.logger.debug(`Using non-NTR formula for ${htsNumber}`);
      return {
        formula: htsEntry.otherRateFormula,
        source: 'other',
        confidence: 0.9,
        formulaType: 'OTHER',
        variables: htsEntry.otherRateVariables || null,
      };
    }

    if (chapter99Applies && htsEntry.adjustedFormula) {
      this.logger.debug(`Using Chapter99 adjusted formula for ${htsNumber}`);
      return {
        formula: htsEntry.adjustedFormula,
        source: 'adjusted',
        confidence: 0.95,
        formulaType: 'ADJUSTED',
        variables: htsEntry.adjustedFormulaVariables || null,
      };
    }

    if (htsEntry.rateFormula) {
      this.logger.debug(`Using general formula for ${htsNumber}`);
      return {
        formula: htsEntry.rateFormula,
        source: 'general',
        confidence: 0.9,
        formulaType: 'GENERAL',
        variables: htsEntry.rateVariables || null,
      };
    }

    // Priority 3: Knowledgebase resolution (if available)
    if (this.noteResolutionService) {
      try {
        const rateText = isNonNTR ? htsEntry.otherRate : htsEntry.generalRate;
        if (rateText && /note/i.test(rateText)) {
          const inferredYear = this.extractYear(resolvedVersion);
          const kbResolution = await this.noteResolutionService.resolveNoteReference(
            htsNumber,
            rateText,
            isNonNTR ? 'other' : 'general',
            inferredYear,
          );

          if (kbResolution?.formula) {
            this.logger.debug(`Using knowledgebase formula for ${htsNumber}`);
            return {
              formula: kbResolution.formula,
              source: 'knowledgebase',
              confidence: kbResolution.confidence ?? 0.6,
              formulaType: isNonNTR ? 'OTHER' : 'GENERAL',
            };
          }
        }
      } catch (error) {
        this.logger.warn(`Knowledgebase resolution failed: ${error.message}`);
      }
    }

    throw new Error(`No formula available for HTS ${htsNumber}`);
  }

  private async loadBestMatchingEntry(
    htsNumber: string,
    version?: string,
  ): Promise<HtsEntity | null> {
    const qb = this.htsRepository
      .createQueryBuilder('hts')
      .where('hts.htsNumber = :htsNumber', { htsNumber });

    if (version) {
      qb.andWhere('(hts.version = :version OR hts.sourceVersion = :version)', { version });
    } else {
      qb.andWhere('hts.isActive = true');
    }

    if (version) {
      qb.orderBy(
        'CASE WHEN hts.version = :version OR hts.sourceVersion = :version THEN 1 ELSE 2 END',
        'ASC',
      );
    }
    qb.addOrderBy('hts.isActive', 'DESC').addOrderBy('hts.updatedAt', 'DESC').limit(1);

    if (version) {
      qb.setParameter('version', version);
    }

    return qb.getOne();
  }

  private resolveNonNtrCountries(entry: HtsEntity): string[] {
    const fallback = ['CU', 'KP', 'BY', 'RU'];
    const source = entry.nonNtrApplicableCountries?.length
      ? entry.nonNtrApplicableCountries
      : fallback;
    return source.map((code) => code.toUpperCase());
  }

  private getManualFormulaLookupOrder(desired: string): string[] {
    const order = [desired];
    if (desired === 'OTHER_CHAPTER99') {
      order.push('OTHER', 'GENERAL');
    } else if (desired === 'ADJUSTED') {
      order.push('GENERAL');
    } else if (desired === 'OTHER') {
      order.push('GENERAL');
    }
    return order;
  }

  private extractYear(version?: string | null): number | undefined {
    if (!version) return undefined;
    const match = version.match(/(19|20)\d{2}/);
    return match ? parseInt(match[0], 10) : undefined;
  }
}
