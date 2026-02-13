/**
 * Formula Generation Job Handler
 * Processes formula generation asynchronously using pg-boss
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { HtsEntity } from '@hts/core';
import { HtsFormulaCandidateEntity } from '@hts/core';
import { FormulaGenerationService } from '@hts/core';

@Injectable()
export class FormulaGenerationJobHandler {
  private readonly logger = new Logger(FormulaGenerationJobHandler.name);

  constructor(
    @InjectRepository(HtsEntity)
    private htsRepo: Repository<HtsEntity>,
    @InjectRepository(HtsFormulaCandidateEntity)
    private candidateRepo: Repository<HtsFormulaCandidateEntity>,
    private formulaGenService: FormulaGenerationService,
  ) {}

  /**
   * Execute formula generation job
   */
  async execute(job: {
    data: { htsNumbers?: string[]; batchSize: number };
  }): Promise<void> {
    const { htsNumbers, batchSize } = job.data;

    this.logger.log(`Starting formula generation job. Batch size: ${batchSize}`);

    try {
      // Query HTS entries without formulas
      const query = this.htsRepo
        .createQueryBuilder('hts')
        .where('hts.rateFormula IS NULL')
        .andWhere('hts.generalRate IS NOT NULL')
        .andWhere('hts.generalRate != :free', { free: 'Free' });

      if (htsNumbers && htsNumbers.length > 0) {
        query.andWhere('hts.htsNumber IN (:...numbers)', { numbers: htsNumbers });
      }

      const entries = await query.take(batchSize).getMany();

      this.logger.log(`Found ${entries.length} HTS entries to process`);

      let generated = 0;
      let failed = 0;

      for (const entry of entries) {
        try {
          // Use existing FormulaGenerationService
          const result = await this.formulaGenService.generateFormula(
            entry.generalRate,
            entry.unitOfQuantity || undefined,
          );

          // Map variables to expected format
          const proposedVariables = result.variables.map((varName) => ({
            name: varName,
            type: 'number',
            description: this.getVariableDescription(varName),
            unit: this.getVariableUnit(varName),
          }));

          // Create formula candidate
          await this.candidateRepo.save({
            htsNumber: entry.htsNumber,
            countryCode: 'ALL',
            formulaType: 'GENERAL',
            currentFormula: entry.rateFormula || null,
            proposedFormula: result.formula,
            proposedVariables,
            confidence: result.confidence,
            reasoning:
              result.method === 'pattern'
                ? `Generated using pattern matching for rate: "${entry.generalRate}"`
                : `Generated using AI for complex rate: "${entry.generalRate}"`,
            status: 'PENDING',
            metadata: {
              method: result.method,
              originalRate: entry.generalRate,
              unitOfQuantity: entry.unitOfQuantity,
              generatedAt: new Date().toISOString(),
            },
          });

          generated++;

          if (generated % 100 === 0) {
            this.logger.log(`Progress: ${generated}/${entries.length} formulas generated`);
          }
        } catch (error) {
          this.logger.error(
            `Failed to generate formula for ${entry.htsNumber}: ${error.message}`,
          );
          failed++;
        }
      }

      this.logger.log(
        `Formula generation job completed. Generated: ${generated}, Failed: ${failed}`,
      );
    } catch (error) {
      this.logger.error(`Formula generation job failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get variable description
   */
  private getVariableDescription(varName: string): string {
    const descriptions: Record<string, string> = {
      value: 'Declared value of the goods',
      weight: 'Weight in kilograms',
      quantity: 'Number of items/units',
    };

    return descriptions[varName] || `${varName} variable`;
  }

  /**
   * Get variable unit
   */
  private getVariableUnit(varName: string): string {
    const units: Record<string, string> = {
      value: '$',
      weight: 'kg',
      quantity: 'units',
    };

    return units[varName] || '';
  }
}
