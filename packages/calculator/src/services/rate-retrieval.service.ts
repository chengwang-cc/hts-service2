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
    source: 'manual' | 'knowledgebase' | 'general' | 'other';
    confidence: number;
    overrideExtraTax?: boolean;
    formulaType?: string;
    variables?: Array<{ name: string; type: string; description?: string; unit?: string }> | null;
  }> {
    const normalizedCountry = countryOfOrigin.toUpperCase();
    const isNonNTR = ['CU', 'KP', 'BY', 'RU'].includes(normalizedCountry);
    const desiredFormulaType = isNonNTR ? 'OTHER' : 'GENERAL';

    // Load HTS entry to determine version and base formulas
    const htsEntry = await this.htsRepository.findOne({
      where: { htsNumber },
    });

    if (!htsEntry) {
      throw new Error(`HTS code ${htsNumber} not found`);
    }

    const resolvedVersion =
      version || (htsEntry as any).version || htsEntry.sourceVersion || null;

    // Priority 1: Manual override (version + country + type aware)
    const manualOverride = await this.formulaUpdateService.findUpdatedFormula({
      htsNumber,
      countryCode: normalizedCountry,
      formulaType: desiredFormulaType,
      version: resolvedVersion,
    });

    if (manualOverride) {
      this.logger.debug(`Using manual override for ${htsNumber}`);
      return {
        formula: manualOverride.formula,
        source: 'manual',
        confidence: 1.0,
        overrideExtraTax: manualOverride.overrideExtraTax,
        formulaType: manualOverride.formulaType,
        variables: manualOverride.formulaVariables ?? null,
      };
    }

    // Priority 2: Standard HTS formulas
    if (isNonNTR && htsEntry.otherRateFormula) {
      this.logger.debug(`Using non-NTR formula for ${htsNumber}`);
      return {
        formula: htsEntry.otherRateFormula,
        source: 'other',
        confidence: 0.9,
        formulaType: 'OTHER',
      };
    }

    if (htsEntry.rateFormula) {
      this.logger.debug(`Using general formula for ${htsNumber}`);
      return {
        formula: htsEntry.rateFormula,
        source: 'general',
        confidence: 0.9,
        formulaType: 'GENERAL',
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
              formulaType: desiredFormulaType,
            };
          }
        }
      } catch (error) {
        this.logger.warn(`Knowledgebase resolution failed: ${error.message}`);
      }
    }

    throw new Error(`No formula available for HTS ${htsNumber}`);
  }

  private extractYear(version?: string | null): number | undefined {
    if (!version) return undefined;
    const match = version.match(/(19|20)\d{2}/);
    return match ? parseInt(match[0], 10) : undefined;
  }
}
