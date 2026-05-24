import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ParityComparisonRunEntity } from '../entities/parity-comparison-run.entity';
import { ParityComparisonRowEntity } from '../entities/parity-comparison-row.entity';
import { QueueService } from '../../queue/queue.service';
import { StartParityRunDto, ReviewParityRowDto } from '../dto/parity.dto';

const HTS_SERVICE_VERSION = 'p0-p6+ca-eu';

/**
 * ParityAdminService
 *
 * CRUD around `ParityComparisonRun` + `ParityComparisonRow`. Spawns the
 * `tariff-parity-comparison` pg-boss job when a run is requested, and
 * provides read access for the admin UI.
 */
@Injectable()
export class ParityAdminService {
  private readonly logger = new Logger(ParityAdminService.name);

  constructor(
    @InjectRepository(ParityComparisonRunEntity)
    private readonly runRepo: Repository<ParityComparisonRunEntity>,
    @InjectRepository(ParityComparisonRowEntity)
    private readonly rowRepo: Repository<ParityComparisonRowEntity>,
    private readonly queueService: QueueService,
  ) {}

  async startRun(args: {
    dto: StartParityRunDto;
    initiatedBy: string;
  }): Promise<ParityComparisonRunEntity> {
    const { dto, initiatedBy } = args;
    const scope = dto.scope || 'smoke';
    const corpusFilter = this.scopeToFilter(scope, dto);

    const run = this.runRepo.create({
      status: 'queued',
      initiatedBy,
      scope,
      corpusFilter,
      corpusSize: 0,
      rowsProcessed: 0,
      rowsMatched: 0,
      rowsMismatched: 0,
      rowsAiServiceUnavailable: 0,
      aiServiceVersion: null,
      htsServiceVersion: HTS_SERVICE_VERSION,
      htsDataVersion: null,
      aiServiceUrl: dto.aiServiceUrl || null,
    });
    const saved = await this.runRepo.save(run);

    await this.queueService.sendJob('tariff-parity-comparison', {
      runId: saved.id,
      initiatedBy,
    });
    this.logger.log(
      `Parity run queued: id=${saved.id} scope=${scope} initiatedBy=${initiatedBy}`,
    );
    return saved;
  }

  listRuns(limit: number = 50): Promise<ParityComparisonRunEntity[]> {
    return this.runRepo.find({
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(1, limit), 200),
    });
  }

  async getRun(id: string): Promise<ParityComparisonRunEntity> {
    const run = await this.runRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException(`Parity run ${id} not found`);
    return run;
  }

  async listRows(
    runId: string,
    filters: {
      matched?: 'true' | 'false';
      mismatchReason?: string;
      chapter?: string;
      country?: string;
      reviewStatus?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ rows: ParityComparisonRowEntity[]; total: number }> {
    const qb = this.rowRepo
      .createQueryBuilder('row')
      .where('row.runId = :runId', { runId });

    if (filters.matched === 'true') {
      qb.andWhere('row.matched = true');
    } else if (filters.matched === 'false') {
      qb.andWhere('row.matched = false');
    }
    if (filters.mismatchReason) {
      qb.andWhere('row.mismatchReason = :reason', {
        reason: filters.mismatchReason,
      });
    }
    if (filters.chapter) {
      qb.andWhere('row.chapter = :chapter', { chapter: filters.chapter });
    }
    if (filters.country) {
      qb.andWhere('row.countryOfOrigin = :country', {
        country: filters.country.toUpperCase(),
      });
    }
    if (filters.reviewStatus) {
      qb.andWhere('row.reviewStatus = :rs', { rs: filters.reviewStatus });
    }

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('row.createdAt', 'DESC')
      .limit(Math.min(Math.max(1, filters.limit ?? 50), 500))
      .offset(Math.max(0, filters.offset ?? 0))
      .getMany();
    return { rows, total };
  }

  async getRow(id: string): Promise<ParityComparisonRowEntity> {
    const row = await this.rowRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Parity row ${id} not found`);
    return row;
  }

  async reviewRow(
    id: string,
    dto: ReviewParityRowDto,
    reviewedBy: string,
  ): Promise<ParityComparisonRowEntity> {
    const row = await this.getRow(id);
    row.reviewStatus = dto.status;
    row.reviewerNote = dto.note ?? null;
    row.reviewedBy = reviewedBy;
    row.reviewedAt = new Date();
    return this.rowRepo.save(row);
  }

  async revalidateRow(id: string): Promise<{ jobId: string }> {
    const row = await this.getRow(id);
    const jobId = await this.queueService.sendJob('parity-ai-validate', {
      rowId: row.id,
    });
    return { jobId };
  }

  async cancelRun(id: string, reason?: string): Promise<ParityComparisonRunEntity> {
    const run = await this.getRun(id);
    if (run.status === 'completed') return run;
    run.status = 'cancelled';
    run.cancelReason = reason ?? null;
    run.completedAt = new Date();
    return this.runRepo.save(run);
  }

  /** Summary endpoint for the admin overview chart. */
  async summary(runId: string): Promise<{
    mismatchByReason: Record<string, number>;
    mismatchByChapter: Record<string, number>;
    mismatchByCountry: Record<string, number>;
    verdictByCount: Record<string, number>;
  }> {
    const byReason = await this.rowRepo
      .createQueryBuilder('row')
      .select('row.mismatchReason', 'reason')
      .addSelect('COUNT(*)', 'cnt')
      .where('row.runId = :runId', { runId })
      .andWhere('row.matched = false')
      .groupBy('row.mismatchReason')
      .getRawMany<{ reason: string; cnt: string }>();
    const byChapter = await this.rowRepo
      .createQueryBuilder('row')
      .select('row.chapter', 'chapter')
      .addSelect('COUNT(*)', 'cnt')
      .where('row.runId = :runId', { runId })
      .andWhere('row.matched = false')
      .groupBy('row.chapter')
      .getRawMany<{ chapter: string; cnt: string }>();
    const byCountry = await this.rowRepo
      .createQueryBuilder('row')
      .select('row.countryOfOrigin', 'country')
      .addSelect('COUNT(*)', 'cnt')
      .where('row.runId = :runId', { runId })
      .andWhere('row.matched = false')
      .groupBy('row.countryOfOrigin')
      .getRawMany<{ country: string; cnt: string }>();
    const byVerdict = await this.rowRepo
      .createQueryBuilder('row')
      .select('row.aiValidationVerdict', 'verdict')
      .addSelect('COUNT(*)', 'cnt')
      .where('row.runId = :runId', { runId })
      .andWhere('row.aiValidationStatus = :s', { s: 'completed' })
      .groupBy('row.aiValidationVerdict')
      .getRawMany<{ verdict: string | null; cnt: string }>();

    const toMap = (arr: any[], key: string) =>
      arr.reduce<Record<string, number>>((acc, r) => {
        acc[r[key] ?? 'unknown'] = Number(r.cnt);
        return acc;
      }, {});

    return {
      mismatchByReason: toMap(byReason, 'reason'),
      mismatchByChapter: toMap(byChapter, 'chapter'),
      mismatchByCountry: toMap(byCountry, 'country'),
      verdictByCount: toMap(byVerdict, 'verdict'),
    };
  }

  // ── helpers ────────────────────────────────────────────────────────

  private scopeToFilter(
    scope: 'smoke' | 'sample' | 'full' | 'custom',
    dto: StartParityRunDto,
  ): Record<string, any> {
    switch (scope) {
      case 'smoke':
        return {
          chapters: dto.chapters,
          countries: dto.countries ?? ['CN', 'DE'],
          valueBands: dto.valueBands ?? [100],
          perHeading: dto.perHeading ?? 1,
        };
      case 'sample':
        return {
          chapters: dto.chapters,
          countries: dto.countries,
          valueBands: dto.valueBands,
          perHeading: dto.perHeading ?? 2,
        };
      case 'full':
        return {
          chapters: dto.chapters,
          countries: dto.countries,
          valueBands: dto.valueBands,
          perHeading: dto.perHeading ?? 3,
        };
      case 'custom':
      default:
        return {
          chapters: dto.chapters,
          countries: dto.countries,
          valueBands: dto.valueBands,
          perHeading: dto.perHeading,
        };
    }
  }
}
