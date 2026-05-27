import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { RuleReviewAlertEntity } from '../entities/rule-review-alert.entity';

/**
 * RuleReviewAlertService (Phase 8, P8.T9).
 *
 * Records and resolves alerts opened when a knowledge card's content
 * changes. Idempotent on `(ruleId, newHash)` so re-ingesting the same
 * content doesn't spam duplicate alerts.
 */
export interface OpenAlertInput {
  ruleId: string;
  cardKey: string;
  previousHash: string | null;
  newHash: string;
  diffSummary?: string | null;
  aiAdvisoryJson?: Record<string, unknown> | null;
}

@Injectable()
export class RuleReviewAlertService {
  private readonly logger = new Logger(RuleReviewAlertService.name);

  constructor(
    @InjectRepository(RuleReviewAlertEntity)
    private readonly repo: Repository<RuleReviewAlertEntity>,
  ) {}

  /** Idempotent on (ruleId, newHash). */
  async openAlert(input: OpenAlertInput): Promise<RuleReviewAlertEntity> {
    const existing = await this.repo.findOne({
      where: { ruleId: input.ruleId, newHash: input.newHash },
    });
    if (existing) return existing;
    const row = this.repo.create({
      ruleId: input.ruleId,
      cardKey: input.cardKey,
      previousHash: input.previousHash ?? null,
      newHash: input.newHash,
      diffSummary: input.diffSummary ?? null,
      aiAdvisoryJson: input.aiAdvisoryJson ?? null,
      status: 'open',
    } as RuleReviewAlertEntity);
    const saved = await this.repo.save(row);
    this.logger.log(
      `alert.opened ruleId=${input.ruleId} cardKey=${input.cardKey} newHash=${input.newHash.slice(0, 12)}`,
    );
    return saved;
  }

  /** Open alerts list (default 50, newest first). */
  async listOpen(limit = 50): Promise<RuleReviewAlertEntity[]> {
    return this.repo.find({
      where: { status: 'open' },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async listByRule(ruleId: string): Promise<RuleReviewAlertEntity[]> {
    return this.repo.find({
      where: { ruleId },
      order: { createdAt: 'DESC' },
    });
  }

  async listSinceForDigest(since: Date): Promise<RuleReviewAlertEntity[]> {
    return this.repo
      .createQueryBuilder('a')
      .where('a.status = :status', { status: 'open' })
      .andWhere('a.createdAt >= :since', { since })
      .orderBy('a.createdAt', 'DESC')
      .getMany();
  }

  async resolve(args: {
    id: string;
    status: 'dismissed' | 'actioned';
    actor: string;
    note?: string | null;
    prUrl?: string | null;
  }): Promise<RuleReviewAlertEntity> {
    const row = await this.repo.findOne({ where: { id: args.id } });
    if (!row) throw new NotFoundException(`alert not found: ${args.id}`);
    row.status = args.status;
    row.resolvedBy = args.actor;
    row.resolutionNote = args.note ?? null;
    row.resolutionPrUrl = args.prUrl ?? null;
    row.resolvedAt = new Date();
    const saved = await this.repo.save(row);
    this.logger.log(
      `alert.resolved id=${args.id} status=${args.status} actor=${args.actor}`,
    );
    return saved;
  }

  async attachAdvisory(
    id: string,
    advisory: Record<string, unknown>,
  ): Promise<RuleReviewAlertEntity> {
    await this.repo.update({ id }, { aiAdvisoryJson: advisory } as any);
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`alert not found: ${id}`);
    return row;
  }
}
