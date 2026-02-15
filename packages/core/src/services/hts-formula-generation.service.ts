import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsEntity } from '../entities/hts.entity';
import { FormulaGenerationService } from './formula-generation.service';

type FormulaGenerationOptions = {
  batchSize?: number;
  sourceVersion?: string;
  activeOnly?: boolean;
  includeAdjusted?: boolean;
};

@Injectable()
export class HtsFormulaGenerationService {
  private readonly logger = new Logger(HtsFormulaGenerationService.name);

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
    private readonly formulaGenerationService: FormulaGenerationService,
  ) {}

  async generateMissingFormulas(
    options: number | FormulaGenerationOptions = 100,
  ): Promise<{
    generalUpdated: number;
    otherUpdated: number;
    adjustedUpdated: number;
    failed: number;
    unresolvedGeneral: number;
    unresolvedOther: number;
    unresolvedAdjusted: number;
  }> {
    const resolvedOptions: FormulaGenerationOptions =
      typeof options === 'number'
        ? { batchSize: options }
        : options;

    const batchSize = Math.max(1, resolvedOptions.batchSize ?? 250);
    const includeAdjusted = resolvedOptions.includeAdjusted ?? true;

    const [generalEntries, otherEntries, adjustedEntries] = await Promise.all([
      this.createMissingFormulaQuery(
        'rateFormula',
        'generalRate',
        resolvedOptions.sourceVersion,
        resolvedOptions.activeOnly,
      ).getMany(),
      this.createMissingFormulaQuery(
        'otherRateFormula',
        'otherRate',
        resolvedOptions.sourceVersion,
        resolvedOptions.activeOnly,
      ).getMany(),
      includeAdjusted
        ? this.createMissingFormulaQuery(
            'adjustedFormula',
            'chapter99',
            resolvedOptions.sourceVersion,
            resolvedOptions.activeOnly,
          ).getMany()
        : Promise.resolve([]),
    ]);

    let generalUpdated = 0;
    let otherUpdated = 0;
    let adjustedUpdated = 0;
    let failed = 0;
    let unresolvedGeneral = 0;
    let unresolvedOther = 0;
    let unresolvedAdjusted = 0;

    this.logger.log(
      `Generating deterministic formulas (version=${resolvedOptions.sourceVersion || 'ALL'}, activeOnly=${resolvedOptions.activeOnly ? 'yes' : 'no'})`,
    );

    this.logger.log(`Generating formulas for ${generalEntries.length} general rates`);
    for (let i = 0; i < generalEntries.length; i += batchSize) {
      const batch = generalEntries.slice(i, i + batchSize);
      try {
        const { updates, unresolved } = this.buildUpdates(
          batch,
          'generalRate',
          'rateFormula',
          'rateVariables',
          'isFormulaGenerated',
          'formula',
        );
        unresolvedGeneral += unresolved;

        if (updates.length > 0) {
          await this.htsRepository.save(updates);
          generalUpdated += updates.length;
        }
      } catch (error) {
        failed += batch.length;
        this.logger.error(`General batch failed: ${error.message}`);
      }
    }

    this.logger.log(`Generating formulas for ${otherEntries.length} other rates`);
    for (let i = 0; i < otherEntries.length; i += batchSize) {
      const batch = otherEntries.slice(i, i + batchSize);
      try {
        const { updates, unresolved } = this.buildUpdates(
          batch,
          'otherRate',
          'otherRateFormula',
          'otherRateVariables',
          'isOtherFormulaGenerated',
          'otherFormula',
        );
        unresolvedOther += unresolved;

        if (updates.length > 0) {
          await this.htsRepository.save(updates);
          otherUpdated += updates.length;
        }
      } catch (error) {
        failed += batch.length;
        this.logger.error(`Other batch failed: ${error.message}`);
      }
    }

    if (includeAdjusted) {
      this.logger.log(`Generating formulas for ${adjustedEntries.length} adjusted rates`);
      for (let i = 0; i < adjustedEntries.length; i += batchSize) {
        const batch = adjustedEntries.slice(i, i + batchSize);
        try {
          const { updates, unresolved } = this.buildUpdates(
            batch,
            'chapter99',
            'adjustedFormula',
            'adjustedFormulaVariables',
            'isAdjustedFormulaGenerated',
            'adjustedFormula',
          );
          unresolvedAdjusted += unresolved;

          if (updates.length > 0) {
            await this.htsRepository.save(updates);
            adjustedUpdated += updates.length;
          }
        } catch (error) {
          failed += batch.length;
          this.logger.error(`Adjusted batch failed: ${error.message}`);
        }
      }
    }

    return {
      generalUpdated,
      otherUpdated,
      adjustedUpdated,
      failed,
      unresolvedGeneral,
      unresolvedOther,
      unresolvedAdjusted,
    };
  }

  private createMissingFormulaQuery(
    formulaColumn: keyof HtsEntity,
    rateColumn: keyof HtsEntity,
    sourceVersion?: string,
    activeOnly?: boolean,
  ) {
    const query = this.htsRepository
      .createQueryBuilder('hts')
      .where(`hts.${String(formulaColumn)} IS NULL`)
      .andWhere(`hts.${String(rateColumn)} IS NOT NULL`)
      .andWhere(`btrim(hts.${String(rateColumn)}) <> ''`);

    if (sourceVersion) {
      query.andWhere('hts.sourceVersion = :sourceVersion', { sourceVersion });
    }

    if (activeOnly) {
      query.andWhere('hts.isActive = :isActive', { isActive: true });
    }

    return query;
  }

  private buildUpdates(
    entries: HtsEntity[],
    rateField: 'generalRate' | 'otherRate' | 'chapter99',
    formulaField: 'rateFormula' | 'otherRateFormula' | 'adjustedFormula',
    variablesField: 'rateVariables' | 'otherRateVariables' | 'adjustedFormulaVariables',
    generatedFlagField: 'isFormulaGenerated' | 'isOtherFormulaGenerated' | 'isAdjustedFormulaGenerated',
    metadataPrefix: 'formula' | 'otherFormula' | 'adjustedFormula',
  ): { updates: HtsEntity[]; unresolved: number } {
    const updates: HtsEntity[] = [];
    let unresolved = 0;
    const generatedAt = new Date().toISOString();

    for (const entry of entries) {
      const rateText = (entry[rateField] || '').toString();
      const result = this.formulaGenerationService.generateFormulaByPattern(
        rateText,
        entry.unitOfQuantity || undefined,
      );

      if (!result) {
        unresolved++;
        continue;
      }

      const metadata = {
        ...(entry.metadata || {}),
        [`${metadataPrefix}Confidence`]: result.confidence,
        [`${metadataPrefix}Method`]: 'pattern',
        [`${metadataPrefix}GeneratedAt`]: generatedAt,
      };

      updates.push({
        ...entry,
        [formulaField]: result.formula,
        [variablesField]: this.toVariableObjects(result.variables),
        [generatedFlagField]: true,
        metadata,
      });
    }

    return { updates, unresolved };
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
