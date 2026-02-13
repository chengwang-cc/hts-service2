import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsFormulaUpdateEntity } from '../entities/hts-formula-update.entity';
import { HtsFormulaUpdateDto, SearchFormulaUpdateDto } from '../dto/hts-formula-update.dto';

@Injectable()
export class HtsFormulaUpdateService {
  constructor(
    @InjectRepository(HtsFormulaUpdateEntity)
    private readonly formulaUpdateRepository: Repository<HtsFormulaUpdateEntity>,
  ) {}

  async upsert(dto: HtsFormulaUpdateDto): Promise<HtsFormulaUpdateEntity> {
    const normalizedCountry = dto.countryCode?.toUpperCase() || 'ALL';
    const normalizedFormulaType = dto.formulaType?.toUpperCase();

    const existing = await this.formulaUpdateRepository.findOne({
      where: {
        htsNumber: dto.htsNumber,
        countryCode: normalizedCountry,
        formulaType: normalizedFormulaType,
      },
    });

    const payload: Partial<HtsFormulaUpdateEntity> = {
      htsNumber: dto.htsNumber,
      countryCode: normalizedCountry,
      formulaType: normalizedFormulaType,
      formula: dto.formula,
      formulaVariables: dto.formulaVariables ?? null,
      comment: dto.comment ?? null,
      active: dto.active ?? true,
      carryover: dto.carryover ?? true,
      overrideExtraTax: dto.overrideExtraTax ?? false,
      updateVersion: dto.updateVersion,
    };

    if (existing) {
      Object.assign(existing, payload);
      return this.formulaUpdateRepository.save(existing);
    }

    const created = this.formulaUpdateRepository.create(payload);
    return this.formulaUpdateRepository.save(created);
  }

  async search(filters: SearchFormulaUpdateDto): Promise<{
    data: HtsFormulaUpdateEntity[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const qb = this.formulaUpdateRepository.createQueryBuilder('hfu');

    if (filters.htsNumber) {
      qb.andWhere('hfu.htsNumber ILIKE :htsNumber', {
        htsNumber: `%${filters.htsNumber}%`,
      });
    }

    if (filters.countryCode) {
      qb.andWhere('hfu.countryCode = :countryCode', {
        countryCode: filters.countryCode.toUpperCase(),
      });
    }

    if (filters.formulaType) {
      qb.andWhere('hfu.formulaType = :formulaType', {
        formulaType: filters.formulaType.toUpperCase(),
      });
    }

    if (filters.version) {
      qb.andWhere('(hfu.updateVersion = :version OR hfu.carryover = true)', {
        version: filters.version,
      });
    }

    if (filters.active !== undefined) {
      const active =
        typeof filters.active === 'string'
          ? filters.active === 'true'
          : filters.active;
      qb.andWhere('hfu.active = :active', { active });
    }

    const total = await qb.getCount();

    const page = Number(filters.page) || 1;
    const limit = Number(filters.limit) || 20;
    const offset = (page - 1) * limit;

    const sortBy = filters.sortBy || 'updatedAt';
    const sortOrder = filters.sortOrder || 'DESC';
    qb.orderBy(`hfu.${sortBy}`, sortOrder);

    qb.skip(offset).take(limit);

    const data = await qb.getMany();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findUpdatedFormula(options: {
    htsNumber: string;
    countryCode: string;
    formulaType: string;
    version?: string | null;
  }): Promise<HtsFormulaUpdateEntity | null> {
    const { htsNumber, formulaType, version } = options;
    const countryCode = options.countryCode?.toUpperCase() || 'ALL';

    const qb = this.formulaUpdateRepository
      .createQueryBuilder('hfu')
      .where('hfu.htsNumber = :htsNumber', { htsNumber })
      .andWhere('hfu.formulaType = :formulaType', { formulaType })
      .andWhere('hfu.active = true')
      .andWhere('(hfu.countryCode = :countryCode OR hfu.countryCode = :all)', {
        countryCode,
        all: 'ALL',
      });

    if (version) {
      qb.andWhere('(hfu.updateVersion = :version OR hfu.carryover = true)', {
        version,
      });
    }

    if (version) {
      qb.orderBy(
        'CASE WHEN hfu.updateVersion = :version THEN 1 ELSE 2 END',
        'ASC',
      );
    }

    qb.addOrderBy(
      'CASE WHEN hfu.countryCode = :countryCode THEN 1 ELSE 2 END',
      'ASC',
    ).addOrderBy('hfu.updatedAt', 'DESC');

    if (version) {
      qb.setParameter('version', version);
    }

    qb.setParameter('countryCode', countryCode);

    return qb.getOne();
  }
}
