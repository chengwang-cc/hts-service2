import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsEntity } from '../entities/hts.entity';
import { FormulaGenerationService } from './formula-generation.service';

@Injectable()
export class HtsFormulaGenerationService {
  private readonly logger = new Logger(HtsFormulaGenerationService.name);

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
    private readonly formulaGenerationService: FormulaGenerationService,
  ) {}

  async generateMissingFormulas(batchSize: number = 100): Promise<{
    generalUpdated: number;
    otherUpdated: number;
    failed: number;
  }> {
    const generalEntries = await this.htsRepository
      .createQueryBuilder('hts')
      .where('hts.rateFormula IS NULL')
      .andWhere('hts.generalRate IS NOT NULL')
      .andWhere("hts.generalRate <> ''")
      .getMany();

    const otherEntries = await this.htsRepository
      .createQueryBuilder('hts')
      .where('hts.otherRateFormula IS NULL')
      .andWhere('hts.otherRate IS NOT NULL')
      .andWhere("hts.otherRate <> ''")
      .getMany();

    let generalUpdated = 0;
    let otherUpdated = 0;
    let failed = 0;

    this.logger.log(`Generating formulas for ${generalEntries.length} general rates`);
    for (let i = 0; i < generalEntries.length; i += batchSize) {
      const batch = generalEntries.slice(i, i + batchSize);
      try {
        const results = await this.formulaGenerationService.generateFormulaBatch(
          batch.map((entry) => ({
            rateText: entry.generalRate || '',
            unitOfQuantity: entry.unitOfQuantity || undefined,
          })),
        );

        const updates = batch.map((entry, idx) => {
          const result = results[idx];
          return {
            ...entry,
            rateFormula: result.formula,
            rateVariables: this.toVariableObjects(result.variables),
            isFormulaGenerated: true,
            metadata: {
              ...(entry.metadata || {}),
              formulaConfidence: result.confidence,
              formulaMethod: result.method,
              formulaGeneratedAt: new Date().toISOString(),
            },
          };
        });

        await this.htsRepository.save(updates);
        generalUpdated += updates.length;
      } catch (error) {
        failed += batch.length;
        this.logger.error(`General batch failed: ${error.message}`);
      }
    }

    this.logger.log(`Generating formulas for ${otherEntries.length} other rates`);
    for (let i = 0; i < otherEntries.length; i += batchSize) {
      const batch = otherEntries.slice(i, i + batchSize);
      try {
        const results = await this.formulaGenerationService.generateFormulaBatch(
          batch.map((entry) => ({
            rateText: entry.otherRate || '',
            unitOfQuantity: entry.unitOfQuantity || undefined,
          })),
        );

        const updates = batch.map((entry, idx) => {
          const result = results[idx];
          return {
            ...entry,
            otherRateFormula: result.formula,
            otherRateVariables: this.toVariableObjects(result.variables),
            isOtherFormulaGenerated: true,
            metadata: {
              ...(entry.metadata || {}),
              otherFormulaConfidence: result.confidence,
              otherFormulaMethod: result.method,
              otherFormulaGeneratedAt: new Date().toISOString(),
            },
          };
        });

        await this.htsRepository.save(updates);
        otherUpdated += updates.length;
      } catch (error) {
        failed += batch.length;
        this.logger.error(`Other batch failed: ${error.message}`);
      }
    }

    return { generalUpdated, otherUpdated, failed };
  }

  private toVariableObjects(variables: string[]): Array<{
    name: string;
    type: string;
    description?: string;
    unit?: string;
  }> {
    return variables.map((name) => ({
      name,
      type: 'number',
      description: this.describeVariable(name),
    }));
  }

  private describeVariable(name: string): string {
    switch (name) {
      case 'value':
        return 'Declared value of goods in USD';
      case 'weight':
        return 'Weight of goods in kilograms';
      case 'quantity':
        return 'Number of items';
      default:
        return 'Input variable';
    }
  }
}
