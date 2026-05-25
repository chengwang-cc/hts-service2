import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
} from '../../broker-entries/entities';
import { QueueService } from '../../queue/queue.service';
import {
  BrokerAiSuggestionEntity,
} from '../entities';
import { BrokerDecisionsService } from '../services/broker-decisions.service';

export const POLICY_EXPOSURE_QUEUE = 'broker.policy.exposure.tick';

/**
 * R2-A-02 — runs over every entry in `in_review` and creates
 * `BrokerAiSuggestion{suggestionType:'special_program'}` rows for lines that
 * appear to be hit by:
 *   - Chapter 99 (special trade programs / additional duties)
 *   - Section 232 ranges (steel/aluminum chapters 72/73/76)
 *   - Section 301 (China-origin commodities in select chapters)
 *
 * The actual policy-change-monitor module isn't on this branch; this is a
 * heuristic scan based on HTS prefix + country of origin so the workbench
 * surfaces exposure indicators that a broker still has to confirm. A full
 * policy_event_subscription wiring lands when the policy-change-monitor
 * module is ported (out of R1 scope).
 */
@Injectable()
export class PolicyExposureAgent implements OnModuleInit {
  private readonly logger = new Logger(PolicyExposureAgent.name);

  constructor(
    @InjectRepository(BrokerEntryEntity)
    private readonly entries: Repository<BrokerEntryEntity>,
    @InjectRepository(BrokerEntryLineEntity)
    private readonly lines: Repository<BrokerEntryLineEntity>,
    @InjectRepository(BrokerAiSuggestionEntity)
    private readonly suggestions: Repository<BrokerAiSuggestionEntity>,
    @Optional() private readonly queue: QueueService | null,
    @Optional() private readonly decisions: BrokerDecisionsService | null,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.queue) return;
    await this.queue.registerHandler(
      POLICY_EXPOSURE_QUEUE,
      async () => {
        try {
          const count = await this.scanRecent();
          if (count > 0) {
            this.logger.log(`Policy exposure agent emitted ${count} suggestions`);
          }
        } catch (err) {
          this.logger.error(
            `Policy exposure tick failed: ${(err as Error).message}`,
          );
        }
      },
      { teamSize: 1, teamConcurrency: 1 },
    );
    if (process.env.JEST_WORKER_ID !== undefined) return;
    const cron =
      process.env.BROKER_POLICY_EXPOSURE_CRON || '*/15 * * * *';
    try {
      await this.queue.scheduleJob(POLICY_EXPOSURE_QUEUE, cron);
      this.logger.log(`Policy exposure agent scheduled: ${cron}`);
    } catch (err) {
      this.logger.warn(
        `Failed to schedule policy exposure cron: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Scans every entry whose status is in the review pipeline and emits one
   * suggestion per (line, exposure) pair that doesn't already have a
   * pending suggestion of the same type for that line.
   */
  async scanRecent(): Promise<number> {
    const entries = await this.entries.find({
      where: [
        { status: 'in_review' },
        { status: 'ready_to_file' },
        { status: 'draft' },
      ],
      take: 200,
      order: { updatedAt: 'DESC' },
    });
    let emitted = 0;
    for (const entry of entries) {
      const lines = await this.lines.find({ where: { entryId: entry.id } });
      for (const line of lines) {
        const exposures = this.detectExposures(line);
        for (const exposure of exposures) {
          const already = await this.suggestions.findOne({
            where: {
              brokerOrganizationId: entry.brokerOrganizationId,
              targetType: 'broker_entry_line',
              targetId: line.id,
              suggestionType: 'special_program',
              status: 'pending',
            },
          });
          if (already) continue;
          await this.suggestions.save(
            this.suggestions.create({
              brokerOrganizationId: entry.brokerOrganizationId,
              targetType: 'broker_entry_line',
              targetId: line.id,
              suggestionType: 'special_program',
              value: {
                program: exposure.program,
                code: exposure.code,
                note: exposure.note,
              },
              confidence: exposure.confidence.toFixed(4),
              modelVersion: 'policy-exposure-heuristic@v1',
              evidence: {
                rationale: exposure.note,
                inputs: {
                  htsNumber: line.htsNumber ?? null,
                  countryOfOrigin: line.countryOfOrigin ?? null,
                },
              },
              status: 'pending',
            }),
          );
          emitted += 1;
        }
      }
    }
    return emitted;
  }

  private detectExposures(line: BrokerEntryLineEntity): Array<{
    program: string;
    code?: string;
    note: string;
    confidence: number;
  }> {
    const hts = (line.htsNumber ?? '').replace(/[^\d]/g, '');
    const origin = (line.countryOfOrigin ?? '').toUpperCase();
    const out: Array<{
      program: string;
      code?: string;
      note: string;
      confidence: number;
    }> = [];
    if (!hts) return out;
    const chapter = hts.slice(0, 2);
    const subchapter = hts.slice(0, 4);

    if (chapter === '99') {
      out.push({
        program: 'CHAPTER_99',
        code: hts.slice(0, 8),
        note: 'Chapter 99 line — confirm special trade program eligibility and any additional duties.',
        confidence: 0.9,
      });
    }
    if (
      (chapter === '72' || chapter === '73' || chapter === '76') &&
      origin !== 'US'
    ) {
      out.push({
        program: 'SECTION_232',
        code: subchapter,
        note: 'Steel/aluminum chapter under Section 232 scope — verify additional duty applicability.',
        confidence: 0.75,
      });
    }
    if (
      origin === 'CN' &&
      (chapter === '84' ||
        chapter === '85' ||
        chapter === '90' ||
        chapter === '94')
    ) {
      out.push({
        program: 'SECTION_301',
        code: subchapter,
        note: 'China-origin commodity in a Section 301 list — verify List 1-4A duty rate.',
        confidence: 0.7,
      });
    }
    return out;
  }
}
