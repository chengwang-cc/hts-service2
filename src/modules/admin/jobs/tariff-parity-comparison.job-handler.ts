/**
 * tariff-parity-comparison job handler
 *
 * Orchestrates a single parity sweep:
 *   1. Load corpus per run.corpusFilter.
 *   2. For each chunk: call local TariffRateBatchService + ai-service in parallel.
 *   3. Diff per row, classify mismatch, persist ParityComparisonRowEntity.
 *   4. Queue parity-ai-validate for non-trivial mismatches.
 *   5. Update run counters + final summary.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ParityComparisonRunEntity } from '../entities/parity-comparison-run.entity';
import { ParityComparisonRowEntity } from '../entities/parity-comparison-row.entity';
import { ParityCorpusService, CorpusRow } from '../services/parity-corpus.service';
import { TariffRateBatchService } from '@hts/calculator';
import { AiServiceProxyService } from '../../public-api/v1/services/ai-service-proxy.service';
import { QueueService } from '../../queue/queue.service';

const CHUNK_SIZE = 50;
const TOLERANCE = 0.01;

type MismatchReason =
  | 'NONE'
  | 'ROUNDING_DIFFERENCE'
  // Deprecated — replaced by LOCAL_MISSING_EXTRA_TAX after live-run
  // analysis showed every row in this bucket was actually a hts-service
  // data gap, not an ai-service FTA bug. Kept in the union so historical
  // rows still parse.
  | 'KNOWN_AI_BUG_SPECIAL_RATE_COMMENTED'
  | 'KNOWN_AI_BUG_DUPLICATE_ROW'
  | 'AI_SERVICE_UNAVAILABLE'
  | 'LOCAL_BLOCKED_AI_UNBLOCKED'
  /** ai-service blocked the row for reasons other than the three below;
   *  hts-service did not. Residual / unclassified block. */
  | 'AI_BLOCKED_LOCAL_UNBLOCKED'
  /** ai-service blocks the row via a Chit Chats shipping-policy rule
   *  (e.g. "live animals cannot be shipped"). NOT a hts-service bug —
   *  hts-service deliberately omits shipping policy. */
  | 'AI_BUSINESS_RULE_BLOCK'
  /** ai-service rejects the HTS code as not in its catalog (most often a
   *  valid 8-digit subheading hts-service knows but ai's catalog only
   *  carries the 10-digit children of). Data gap on ai's side. */
  | 'AI_CATALOG_GAP'
  /** ai-service's formula evaluator threw (multiplyScalar / undefined
   *  symbol) because it lacks an input variable (weight/quantity).
   *  hts-service successfully resolved. */
  | 'AI_FORMULA_ERROR'
  | 'COMPONENT_COUNT_DIFFERS'
  | 'COMPONENT_AMOUNT_DIFFERS'
  /** local total is LOWER than ai because ai applied an extra tariff
   *  (section_301/section_122/chapter_99/etc.) that hts-service doesn't
   *  have in its `hts_extra_taxes` table. Data-gap, not code bug. */
  | 'LOCAL_MISSING_EXTRA_TAX'
  /** local total is HIGHER than ai. Real candidate for an hts-service bug
   *  (over-applied a rule or applied something ai-service correctly
   *  excluded). Always escalated to the AI agent. */
  | 'LOCAL_OVERSPECIFIED'
  | 'UNKNOWN';

/**
 * mismatchReasons we do NOT bother asking the AI agent about — they're
 * already deterministically explained.
 */
const SKIP_AI_VALIDATION = new Set<MismatchReason>([
  'NONE',
  'ROUNDING_DIFFERENCE',
  'AI_SERVICE_UNAVAILABLE',
  // KNOWN_AI_BUG_* kept skip-listed for backwards compatibility on
  // historical rows; the classifier no longer emits these.
  'KNOWN_AI_BUG_SPECIAL_RATE_COMMENTED',
  'KNOWN_AI_BUG_DUPLICATE_ROW',
  // The next three are deterministic ai-side gaps — no value asking the
  // LLM to arbitrate, hts-service is correct by construction.
  'AI_BUSINESS_RULE_BLOCK',
  'AI_CATALOG_GAP',
  'AI_FORMULA_ERROR',
]);

@Injectable()
export class TariffParityComparisonJobHandler {
  private readonly logger = new Logger(TariffParityComparisonJobHandler.name);

  constructor(
    @InjectRepository(ParityComparisonRunEntity)
    private readonly runRepo: Repository<ParityComparisonRunEntity>,
    @InjectRepository(ParityComparisonRowEntity)
    private readonly rowRepo: Repository<ParityComparisonRowEntity>,
    private readonly corpusService: ParityCorpusService,
    private readonly tariffRateBatch: TariffRateBatchService,
    private readonly aiService: AiServiceProxyService,
    private readonly queueService: QueueService,
  ) {}

  async execute(job: any): Promise<void> {
    const runId: string = job?.data?.runId;
    if (!runId) {
      this.logger.warn('tariff-parity-comparison: runId missing in job data');
      return;
    }

    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) {
      this.logger.warn(`tariff-parity-comparison: run ${runId} not found`);
      return;
    }
    if (run.status === 'cancelled' || run.status === 'completed') {
      this.logger.log(`Run ${runId} is ${run.status}; skipping`);
      return;
    }

    run.status = 'running';
    run.startedAt = run.startedAt ?? new Date();
    run.aiServiceVersion =
      this.aiService.describeUpstream().baseURL;
    await this.runRepo.save(run);

    let corpus: CorpusRow[] = [];
    try {
      corpus = await this.corpusService.selectCorpus(
        run.corpusFilter as any,
      );
    } catch (e: any) {
      this.logger.error(`Corpus selection failed: ${e?.message}`);
      run.status = 'failed';
      run.completedAt = new Date();
      run.cancelReason = `Corpus selection failed: ${e?.message}`;
      await this.runRepo.save(run);
      return;
    }

    run.corpusSize = corpus.length;
    await this.runRepo.save(run);

    let processed = 0;
    let matched = 0;
    let mismatched = 0;
    let unavailable = 0;

    for (let i = 0; i < corpus.length; i += CHUNK_SIZE) {
      const chunk = corpus.slice(i, i + CHUNK_SIZE);
      const localStart = Date.now();
      const localResults = await this.runLocal(chunk);
      const localElapsed = Date.now() - localStart;

      const aiStart = Date.now();
      const aiResults = await this.runAi(chunk);
      const aiElapsed = Date.now() - aiStart;

      const localMs = Math.max(1, Math.round(localElapsed / chunk.length));
      const aiMs = Math.max(1, Math.round(aiElapsed / chunk.length));

      const toSave: ParityComparisonRowEntity[] = [];
      const toValidate: string[] = [];
      for (let j = 0; j < chunk.length; j++) {
        const input = chunk[j];
        const localRow = localResults[j];
        const aiRow = aiResults[j];

        const classified = this.classify(input, localRow, aiRow);
        if (classified.matched) matched++;
        else mismatched++;
        if (classified.reason === 'AI_SERVICE_UNAVAILABLE') unavailable++;

        const persisted = this.rowRepo.create({
          runId: run.id,
          htsNumber: input.htsNumber,
          chapter: input.chapter,
          heading: input.heading,
          countryOfOrigin: input.countryOfOrigin,
          declaredValue: input.declaredValue,
          inputs: input.inputs,
          rateClass: input.rateClass,
          aiTotalDuty:
            classified.aiSumOfFormulas !== undefined
              ? round2(classified.aiSumOfFormulas)
              : null,
          aiFormulas: aiRow?.formulas ?? null,
          aiBlockReason: aiRow?.block_reason ?? null,
          aiResponseTimeMs: aiRow ? aiMs : null,
          localTotalDuty:
            classified.localTotalDuty !== undefined
              ? round2(classified.localTotalDuty)
              : null,
          localBreakdown: localRow?.breakdown ?? null,
          localBlockReason: localRow?.blockReason ?? null,
          localResponseTimeMs: localRow ? localMs : null,
          delta:
            classified.delta !== undefined
              ? round4(classified.delta)
              : null,
          matched: classified.matched,
          mismatchReason: classified.reason,
          aiValidationStatus: classified.matched
            ? 'skipped'
            : SKIP_AI_VALIDATION.has(classified.reason)
              ? 'skipped'
              : 'pending',
          aiValidationVerdict: classified.matched
            ? 'NONE'
            : SKIP_AI_VALIDATION.has(classified.reason)
              ? classified.reason
              : null,
        });
        toSave.push(persisted);
      }

      const saved = await this.rowRepo.save(toSave);
      for (const s of saved) {
        if (s.aiValidationStatus === 'pending') toValidate.push(s.id);
      }
      processed += chunk.length;

      // Checkpoint counters every chunk.
      run.rowsProcessed = processed;
      run.rowsMatched = matched;
      run.rowsMismatched = mismatched;
      run.rowsAiServiceUnavailable = unavailable;
      await this.runRepo.save(run);

      // Enqueue AI validation jobs for genuine mismatches.
      for (const rowId of toValidate) {
        try {
          await this.queueService.sendJob('parity-ai-validate', { rowId });
        } catch (e: any) {
          this.logger.warn(
            `Failed to enqueue parity-ai-validate for row ${rowId}: ${e?.message}`,
          );
        }
      }

      if ((i / CHUNK_SIZE) % 10 === 0) {
        this.logger.log(
          `Run ${runId}: ${processed}/${corpus.length} processed (matched=${matched}, mismatched=${mismatched})`,
        );
      }
    }

    // Final summary aggregation
    const summary = await this.computeSummary(run.id);
    run.summary = summary;
    run.status = 'completed';
    run.completedAt = new Date();
    await this.runRepo.save(run);

    this.logger.log(
      `Run ${runId} complete: matched=${matched}/${corpus.length} ` +
        `(${((matched / Math.max(1, corpus.length)) * 100).toFixed(2)}%)`,
    );
  }

  private async runLocal(chunk: CorpusRow[]): Promise<any[]> {
    try {
      const requests = chunk.map((c) => ({
        htsCode: c.htsNumber,
        country: c.countryOfOrigin,
        inputs: c.inputs,
      }));
      return await this.tariffRateBatch.batchCalculate(requests);
    } catch (e: any) {
      this.logger.warn(`Local batchCalculate failed: ${e?.message}`);
      return chunk.map(() => undefined);
    }
  }

  private async runAi(chunk: CorpusRow[]): Promise<any[]> {
    try {
      const rows = await this.aiService.getRates(
        chunk.map((c) => ({
          htsCode: c.htsNumber,
          country: c.countryOfOrigin,
          inputs: c.inputs,
        })),
      );
      // ai-service preserves order — but defensively pad.
      const padded = chunk.map((_, i) => rows[i]);
      return padded;
    } catch (e: any) {
      this.logger.warn(`ai-service getRates failed for chunk: ${e?.message}`);
      return chunk.map(() => undefined);
    }
  }

  private classify(
    input: CorpusRow,
    localRow: any | undefined,
    aiRow: any | undefined,
  ): {
    matched: boolean;
    reason: MismatchReason;
    localTotalDuty?: number;
    aiSumOfFormulas?: number;
    delta?: number;
  } {
    // eslint-disable-next-line no-console
    if (!aiRow) {
      return {
        matched: false,
        reason: 'AI_SERVICE_UNAVAILABLE',
        localTotalDuty: localRow?.totalDuty,
      };
    }

    const aiBlocked = !!aiRow.blocked;
    const localBlocked = !!localRow?.blocked;
    if (aiBlocked !== localBlocked) {
      return {
        matched: false,
        reason: aiBlocked
          ? this.classifyAiBlock(aiRow.block_reason ?? aiRow.blockReason)
          : 'LOCAL_BLOCKED_AI_UNBLOCKED',
        localTotalDuty: localRow?.totalDuty,
        aiSumOfFormulas: this.sumAi(aiRow, input.inputs),
      };
    }

    const localTotal = Number(localRow?.totalDuty ?? 0);
    const aiSum = this.sumAi(aiRow, input.inputs);
    const delta = localTotal - aiSum;
    if (Math.abs(delta) <= TOLERANCE) {
      return {
        matched: true,
        reason: 'NONE',
        localTotalDuty: localTotal,
        aiSumOfFormulas: aiSum,
        delta,
      };
    }

    if (Math.abs(delta) < 0.05) {
      return {
        matched: false,
        reason: 'ROUNDING_DIFFERENCE',
        localTotalDuty: localTotal,
        aiSumOfFormulas: aiSum,
        delta,
      };
    }

    const localCount = Array.isArray(localRow?.breakdown)
      ? localRow.breakdown.length
      : 0;
    const aiCount = Array.isArray(aiRow.formulas) ? aiRow.formulas.length : 0;

    // Refined buckets (after live-run analysis 2026-05-23):
    //   - local < ai by more than tolerance: local is MISSING an extra
    //     tax row ai-service has (section_301/section_122/chapter_99).
    //     Data gap, not code bug.
    //   - local > ai: local applied something ai-service didn't. Real
    //     candidate for hts-service bug. Always validate.
    //   - component count differs but totals close: skip the bucket
    //     above; report shape divergence as COMPONENT_COUNT_DIFFERS.
    if (delta < -TOLERANCE) {
      // local is lower → local missing tariff(s) ai has
      return {
        matched: false,
        reason: 'LOCAL_MISSING_EXTRA_TAX',
        localTotalDuty: localTotal,
        aiSumOfFormulas: aiSum,
        delta,
      };
    }
    if (delta > TOLERANCE) {
      // eslint-disable-next-line no-console
      return {
        matched: false,
        reason: 'LOCAL_OVERSPECIFIED',
        localTotalDuty: localTotal,
        aiSumOfFormulas: aiSum,
        delta,
      };
    }

    // eslint-disable-next-line no-console
    if (localCount !== aiCount) {
      return {
        matched: false,
        reason: 'COMPONENT_COUNT_DIFFERS',
        localTotalDuty: localTotal,
        aiSumOfFormulas: aiSum,
        delta,
      };
    }

    return {
      matched: false,
      reason: 'COMPONENT_AMOUNT_DIFFERS',
      localTotalDuty: localTotal,
      aiSumOfFormulas: aiSum,
      delta,
    };
  }

  /**
   * Compute the ai-service's reported total duty for a row.
   *
   * ai-service `/v2/tariff/rates` puts the (base + chapter-99 + section-301)
   * evaluated total in `aiRow.rate` and lists every component in
   * `aiRow.formulas[]` WITHOUT per-formula `amount` fields. Older versions
   * of the same endpoint *did* return per-formula amounts. We accept both:
   *
   *   - If formulas[].amount is present anywhere → sum those (legacy shape).
   *   - Otherwise → fall back to aiRow.rate.
   *   - Then add any extra component amounts NOT already implied by `rate`
   *     (e.g. section_122) by evaluating the formula locally against inputs.
   *     This is intentionally conservative — we only evaluate trivially
   *     parseable `value * X` shapes so we don't introduce new divergence.
   */
  /**
   * Classify an ai-service block reason into a finer-grained mismatch
   * category so the admin UI can distinguish ai-side data/engine gaps
   * (catalog miss, formula eval error) from intentional Chit Chats
   * shipping policy (live animals, restricted goods) from genuinely
   * unclassified blocks.
   */
  private classifyAiBlock(reason: unknown): MismatchReason {
    const r = typeof reason === 'string' ? reason : '';
    if (/invalid hts code|not in catalog|unknown hts/i.test(r)) {
      return 'AI_CATALOG_GAP';
    }
    if (/multiplyScalar|undefined symbol|division by zero|unexpected type/i.test(r)) {
      return 'AI_FORMULA_ERROR';
    }
    if (/cannot be shipped|prohibit|restrict|chapter \d+ of the hts schedule covers/i.test(r)) {
      return 'AI_BUSINESS_RULE_BLOCK';
    }
    return 'AI_BLOCKED_LOCAL_UNBLOCKED';
  }

  private sumAi(aiRow: any, inputs?: Record<string, number>): number {
    const formulas: any[] = Array.isArray(aiRow?.formulas) ? aiRow.formulas : [];
    const hasAmounts = formulas.some(
      (f) => typeof f.amount === 'number' && Number.isFinite(f.amount),
    );
    if (hasAmounts) {
      return formulas.reduce(
        (s: number, f: any) =>
          s + (typeof f.amount === 'number' ? f.amount : 0),
        0,
      );
    }
    const fallbackRate =
      typeof aiRow?.rate === 'number' && Number.isFinite(aiRow.rate)
        ? aiRow.rate
        : 0;
    // If `rate` already covers all formulas (single base-only formula), we
    // can return it directly. If there are MORE formulas than `rate`
    // accounts for, evaluate the trailing simple ones.
    if (formulas.length <= 1) return fallbackRate;
    const value = typeof inputs?.value === 'number' ? inputs.value : 0;
    let extras = 0;
    // ai-service's `rate` field includes the base + chapter_99 / special.
    // We add evaluated amounts for explicit post-tax components ai-service
    // names — these are the ones ai-service is known to NOT roll into rate.
    const postRateTariffTypes = new Set([
      'section_122',
      'mpf',
      'hmf',
      'post_tax',
    ]);
    for (const f of formulas) {
      const tt = (f?.tariffType || '').toLowerCase();
      if (!postRateTariffTypes.has(tt)) continue;
      const m =
        typeof f.formula === 'string'
          ? f.formula.match(/value\s*\*\s*([0-9.]+)/i)
          : null;
      if (m) extras += value * parseFloat(m[1]);
    }
    return fallbackRate + extras;
  }

  private async computeSummary(runId: string): Promise<Record<string, any>> {
    const byReason = await this.rowRepo
      .createQueryBuilder('row')
      .select('row.mismatchReason', 'reason')
      .addSelect('COUNT(*)', 'cnt')
      .where('row.runId = :runId', { runId })
      .groupBy('row.mismatchReason')
      .getRawMany<{ reason: string; cnt: string }>();
    const byChapter = await this.rowRepo
      .createQueryBuilder('row')
      .select('row.chapter', 'chapter')
      .addSelect('COUNT(*)', 'cnt')
      .where('row.runId = :runId AND row.matched = false', { runId })
      .groupBy('row.chapter')
      .getRawMany<{ chapter: string; cnt: string }>();
    const byCountry = await this.rowRepo
      .createQueryBuilder('row')
      .select('row.countryOfOrigin', 'country')
      .addSelect('COUNT(*)', 'cnt')
      .where('row.runId = :runId AND row.matched = false', { runId })
      .groupBy('row.countryOfOrigin')
      .getRawMany<{ country: string; cnt: string }>();
    const toMap = (arr: any[], k: string) =>
      arr.reduce<Record<string, number>>((acc, r) => {
        acc[r[k] ?? 'unknown'] = Number(r.cnt);
        return acc;
      }, {});
    return {
      mismatchByReason: toMap(byReason, 'reason'),
      mismatchByChapter: toMap(byChapter, 'chapter'),
      mismatchByCountry: toMap(byCountry, 'country'),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
