/**
 * Formula Admin Service
 * Business logic for formula management and approval workflow
 */

import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, IsNull, Not } from 'typeorm';
import { HtsEntity } from '@hts/core';
import { HtsFormulaCandidateEntity } from '@hts/core';
import { QueueService } from '../../queue/queue.service';
import { ListFormulasDto, ListCandidatesDto, GenerateFormulasDto } from '../dto/formula.dto';

@Injectable()
export class FormulaAdminService {
  private readonly logger = new Logger(FormulaAdminService.name);

  constructor(
    @InjectRepository(HtsEntity)
    private htsRepo: Repository<HtsEntity>,
    @InjectRepository(HtsFormulaCandidateEntity)
    private candidateRepo: Repository<HtsFormulaCandidateEntity>,
    private queueService: QueueService,
  ) {}

  /**
   * Find all formulas with pagination and filters
   */
  async findAllFormulas(dto: ListFormulasDto): Promise<{
    data: HtsEntity[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const { page, pageSize, htsNumber, generatedOnly } = dto;

    const query = this.htsRepo.createQueryBuilder('hts');

    // Filter: must have a formula
    query.andWhere('hts.rateFormula IS NOT NULL');

    if (htsNumber) {
      query.andWhere('hts.htsNumber LIKE :htsNumber', { htsNumber: `${htsNumber}%` });
    }

    if (generatedOnly) {
      query.andWhere('hts.isFormulaGenerated = :generated', { generated: true });
    }

    query.orderBy('hts.htsNumber', 'ASC');

    const [data, total] = await query
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get formula candidates with filters
   */
  async getCandidates(dto: ListCandidatesDto): Promise<{
    data: HtsFormulaCandidateEntity[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const { status, minConfidence, page, pageSize } = dto;

    const query = this.candidateRepo.createQueryBuilder('candidate');

    query.where('candidate.status = :status', { status });

    if (minConfidence !== undefined) {
      query.andWhere('candidate.confidence >= :minConfidence', { minConfidence });
    }

    query.orderBy('candidate.confidence', 'DESC').addOrderBy('candidate.createdAt', 'DESC');

    const [data, total] = await query
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Trigger formula generation job
   */
  async generateFormulas(dto: GenerateFormulasDto): Promise<{ jobId: string }> {
    const jobId = await this.queueService.sendJob('formula-generation', {
      htsNumbers: dto.htsNumbers,
      batchSize: dto.batchSize,
    });

    this.logger.log(
      `Formula generation job triggered: ${jobId} for ${dto.htsNumbers?.length || 'all'} entries`,
    );

    return { jobId: jobId || '' };
  }

  /**
   * Approve a formula candidate
   */
  async approveCandidate(id: string, userId: string, comment?: string): Promise<void> {
    const candidate = await this.candidateRepo.findOne({ where: { id } });

    if (!candidate) {
      throw new NotFoundException(`Formula candidate not found: ${id}`);
    }

    if (candidate.status !== 'PENDING') {
      throw new Error(`Candidate is not pending. Current status: ${candidate.status}`);
    }

    this.logger.log(`Approving formula candidate ${id} for HTS ${candidate.htsNumber}`);

    // Update HtsEntity with the proposed formula
    await this.htsRepo
      .createQueryBuilder()
      .update(HtsEntity)
      .set({
        rateFormula: candidate.proposedFormula,
        rateVariables: candidate.proposedVariables as any,
        isFormulaGenerated: true,
        metadata: () =>
          `jsonb_set(COALESCE(metadata, '{}'::jsonb), '{formulaConfidence}', '${candidate.confidence}')`,
      })
      .where('htsNumber = :htsNumber', { htsNumber: candidate.htsNumber })
      .execute();

    // Mark candidate as approved
    await this.candidateRepo.update(id, {
      status: 'APPROVED',
      reviewedBy: userId,
      reviewedAt: new Date(),
      reviewComment: comment || null,
    });

    this.logger.log(`Formula candidate ${id} approved successfully`);
  }

  /**
   * Reject a formula candidate
   */
  async rejectCandidate(id: string, userId: string, comment?: string): Promise<void> {
    const candidate = await this.candidateRepo.findOne({ where: { id } });

    if (!candidate) {
      throw new NotFoundException(`Formula candidate not found: ${id}`);
    }

    if (candidate.status !== 'PENDING') {
      throw new Error(`Candidate is not pending. Current status: ${candidate.status}`);
    }

    this.logger.log(`Rejecting formula candidate ${id} for HTS ${candidate.htsNumber}`);

    await this.candidateRepo.update(id, {
      status: 'REJECTED',
      reviewedBy: userId,
      reviewedAt: new Date(),
      reviewComment: comment || null,
    });

    this.logger.log(`Formula candidate ${id} rejected`);
  }

  /**
   * Bulk approve candidates above confidence threshold
   */
  async bulkApprove(
    minConfidence: number,
    userId: string,
    comment?: string,
  ): Promise<{ approved: number }> {
    const candidates = await this.candidateRepo.find({
      where: {
        status: 'PENDING',
        confidence: MoreThanOrEqual(minConfidence),
      },
    });

    this.logger.log(
      `Bulk approving ${candidates.length} candidates with confidence >= ${minConfidence}`,
    );

    let approved = 0;
    for (const candidate of candidates) {
      try {
        await this.approveCandidate(candidate.id, userId, comment || 'Auto-approved by bulk operation');
        approved++;
      } catch (error) {
        this.logger.error(
          `Failed to approve candidate ${candidate.id}: ${error.message}`,
        );
      }
    }

    this.logger.log(`Bulk approval completed: ${approved}/${candidates.length} approved`);

    return { approved };
  }

  /**
   * Get formula metrics
   */
  async getMetrics(): Promise<{
    totalFormulas: number;
    generatedFormulas: number;
    manualFormulas: number;
    pendingCandidates: number;
    avgCandidateConfidence: number;
    coveragePercentage: number;
  }> {
    const [totalFormulas, generatedFormulas, totalHtsEntries, pendingCandidates, avgResult] =
      await Promise.all([
        this.htsRepo.count({ where: { rateFormula: Not(IsNull()) } }),
        this.htsRepo.count({ where: { isFormulaGenerated: true } }),
        this.htsRepo.count(),
        this.candidateRepo.count({ where: { status: 'PENDING' } }),
        this.candidateRepo
          .createQueryBuilder('candidate')
          .select('AVG(candidate.confidence)', 'avg')
          .where('candidate.status = :status', { status: 'PENDING' })
          .getRawOne(),
      ]);

    const manualFormulas = totalFormulas - generatedFormulas;
    const avgCandidateConfidence = parseFloat(avgResult?.avg || '0');
    const coveragePercentage = totalHtsEntries > 0
      ? (totalFormulas / totalHtsEntries) * 100
      : 0;

    return {
      totalFormulas,
      generatedFormulas,
      manualFormulas,
      pendingCandidates,
      avgCandidateConfidence,
      coveragePercentage,
    };
  }
}
