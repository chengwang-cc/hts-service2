import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DgxRerankerService } from '../../../core/dgx/dgx-reranker.service';
import { RerankerTrainingRunEntity } from '../entities/reranker-training-run.entity';

const execAsync = promisify(exec);

interface HtsRow {
  hts_number: string;
  description: string;
  chapter: string;
  full_description: string[] | null;
}

interface FeedbackRow {
  chosen_hts: string;
  content_json: Record<string, unknown> | null;
}

interface TrainingPair {
  query: string;
  positive: string;
  negatives: string[];
}

interface ExportResult {
  path: string;
  pairs: number;
  feedbackPairs: number;
}

@Injectable()
export class RerankerRetrainService {
  private readonly logger = new Logger(RerankerRetrainService.name);

  // SSH / DGX config
  private readonly sshUser: string;
  private readonly sshHost: string;
  private readonly dgxTrainingDataPath: string;
  private readonly dgxTrainScript: string;
  private readonly dgxLogPath: string;
  private readonly dgxComposeFile: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  // Feedback threshold
  private readonly minNewFeedback: number;

  constructor(
    @InjectRepository(RerankerTrainingRunEntity)
    private readonly runRepo: Repository<RerankerTrainingRunEntity>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly dgxReranker: DgxRerankerService,
  ) {
    this.sshUser = config.get('RERANKER_RETRAIN_DGX_SSH_USER', 'cheng');
    this.sshHost = config.get('RERANKER_RETRAIN_DGX_SSH_HOST', '192.168.1.201');
    this.dgxTrainingDataPath = config.get(
      'RERANKER_RETRAIN_DGX_TRAINING_DATA_PATH',
      '/opt/hts-ai/training/reranker-training.jsonl',
    );
    this.dgxTrainScript = config.get(
      'RERANKER_RETRAIN_DGX_TRAIN_SCRIPT',
      '/opt/hts-ai/training/train_reranker.py',
    );
    this.dgxLogPath = config.get(
      'RERANKER_RETRAIN_DGX_LOG_PATH',
      '/tmp/reranker-retrain.log',
    );
    this.dgxComposeFile = config.get(
      'RERANKER_RETRAIN_DGX_COMPOSE_FILE',
      '/opt/hts-ai/docker-compose.yml',
    );
    this.pollIntervalMs = config.get<number>('RERANKER_RETRAIN_POLL_INTERVAL_MS', 300_000);
    this.timeoutMs = config.get<number>('RERANKER_RETRAIN_TIMEOUT_MS', 7_200_000);
    this.minNewFeedback = config.get<number>('RERANKER_RETRAIN_MIN_NEW_FEEDBACK', 500);
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Main entry point called by the pg-boss job handler.
   * Orchestrates the full retrain pipeline and records the result.
   */
  async runFullRetrain(triggeredBy = 'cron'): Promise<RerankerTrainingRunEntity> {
    const run = await this.runRepo.save(
      this.runRepo.create({ triggeredBy, status: 'pending' }),
    );
    this.logger.log(`Retrain run started id=${run.id} triggeredBy=${triggeredBy}`);

    let localPath: string | null = null;

    try {
      // Step 1 — feedback threshold check
      const lastCompleted = await this.getLastCompletedRun();
      const since = lastCompleted?.completedAt ?? new Date(0);
      const newFeedback = await this.getNewFeedbackCount(since);

      this.logger.log(
        `New feedback pairs since last run: ${newFeedback} (threshold=${this.minNewFeedback})`,
      );

      if (newFeedback < this.minNewFeedback) {
        this.logger.log(
          `Not enough feedback (${newFeedback} < ${this.minNewFeedback}), skipping retrain`,
        );
        run.status = 'skipped';
        run.feedbackPairsAdded = newFeedback;
        run.completedAt = new Date();
        return await this.runRepo.save(run);
      }

      // Step 2 — export training data
      run.status = 'running';
      await this.runRepo.save(run);

      const exported = await this.exportTrainingData(run.id);
      localPath = exported.path;
      run.feedbackPairsAdded = exported.feedbackPairs;
      run.totalPairs = exported.pairs;
      this.logger.log(
        `Exported ${exported.pairs} pairs (${exported.feedbackPairs} feedback) to ${exported.path}`,
      );

      // Step 3 — SCP to DGX
      await this.uploadToDgx(localPath);
      this.logger.log(`Uploaded training data to DGX at ${this.dgxTrainingDataPath}`);

      // Step 4 — start training in background
      run.status = 'training';
      await this.runRepo.save(run);

      const sentinelFile = `/tmp/reranker-retrain-done-${run.id}`;
      await this.startTrainingOnDgx(sentinelFile);
      this.logger.log(`Training started on DGX, sentinel=${sentinelFile}`);

      // Step 5 — poll for completion
      const finished = await this.pollForCompletion(sentinelFile);
      if (!finished) {
        throw new Error(`Training timed out after ${this.timeoutMs / 60_000} minutes`);
      }
      this.logger.log('Training complete on DGX');

      // Step 6 — restart Docker container
      run.status = 'restarting';
      await this.runRepo.save(run);
      await this.restartRerankerService();
      this.logger.log('Reranker Docker service restarted');

      // Step 7 — health check
      await this.verifyHealth();
      this.logger.log('DGX reranker health check passed');

      // Step 8 — mark complete
      run.status = 'completed';
      run.completedAt = new Date();
      return await this.runRepo.save(run);
    } catch (err) {
      run.status = 'failed';
      run.errorMessage = (err as Error).message;
      run.completedAt = new Date();
      await this.runRepo.save(run);
      this.logger.error(`Retrain run ${run.id} failed: ${run.errorMessage}`);
      return run;
    } finally {
      // Clean up temp file
      if (localPath) {
        await unlink(localPath).catch(() => undefined);
      }
    }
  }

  // ─── Step helpers ────────────────────────────────────────────────────────────

  async getLastCompletedRun(): Promise<RerankerTrainingRunEntity | null> {
    return this.runRepo.findOne({
      where: { status: 'completed' },
      order: { completedAt: 'DESC' },
    });
  }

  async getNewFeedbackCount(since: Date): Promise<number> {
    const result = await this.dataSource.query<[{ count: string }]>(
      `SELECT COUNT(*)::text AS count
       FROM lookup_conversation_feedback
       WHERE is_correct = false
         AND chosen_hts IS NOT NULL
         AND message_id IS NOT NULL
         AND created_at >= $1`,
      [since],
    );
    return parseInt(result[0].count, 10);
  }

  async exportTrainingData(runId: string): Promise<ExportResult> {
    // Query leaf HTS entries (same logic as export-reranker-training-data.ts)
    const htsRows = await this.dataSource.query<HtsRow[]>(`
      SELECT
        hts_number,
        description,
        chapter,
        full_description
      FROM hts
      WHERE is_active = true
        AND LENGTH(REPLACE(hts_number, '.', '')) >= 8
        AND LENGTH(REPLACE(hts_number, '.', '')) IN (8, 10)
        AND chapter NOT IN ('98', '99')
      ORDER BY hts_number
    `);

    this.logger.log(`Loaded ${htsRows.length} leaf HTS entries for training export`);

    // Group by chapter for hard-negative sampling
    const byChapter = new Map<string, HtsRow[]>();
    for (const row of htsRows) {
      const list = byChapter.get(row.chapter) ?? [];
      list.push(row);
      byChapter.set(row.chapter, list);
    }

    // Build base training pairs
    const pairs: TrainingPair[] = [];
    let skipped = 0;

    for (const row of htsRows) {
      const query = this.buildQuery(row);
      if (query.length < 10) { skipped++; continue; }

      const positive = this.buildCandidateText(row);
      const chapterPeers = byChapter.get(row.chapter) ?? [];
      const negativePool = chapterPeers.filter((p) => p.hts_number !== row.hts_number);

      if (negativePool.length === 0) { skipped++; continue; }

      const shuffled = this.shuffleDeterministic(negativePool, row.hts_number);
      const negatives = shuffled.slice(0, 3).map((p) => this.buildCandidateText(p));
      pairs.push({ query, positive, negatives });
    }

    this.logger.log(`Built ${pairs.length} base pairs (skipped ${skipped})`);

    // Add feedback correction pairs
    const feedbackRows = await this.dataSource.query<FeedbackRow[]>(`
      SELECT
        f.chosen_hts,
        m.content_json
      FROM lookup_conversation_feedback f
      JOIN lookup_conversation_messages m ON m.id = f.message_id
      WHERE f.message_id IS NOT NULL
        AND f.chosen_hts IS NOT NULL
        AND f.is_correct = false
      LIMIT 10000
    `);

    let feedbackPairs = 0;
    const htsIndex = new Map<string, HtsRow>(htsRows.map((r) => [r.hts_number, r]));

    for (const fb of feedbackRows) {
      const content = fb.content_json ?? {};
      const userQuery = (content['answer'] as string | undefined)?.trim();
      if (!userQuery || userQuery.length < 5) continue;

      const chosenRow = htsIndex.get(fb.chosen_hts);
      if (!chosenRow) continue;

      const positive = this.buildCandidateText(chosenRow);
      const aiRec = content['recommendedHts'] as string | undefined;
      const aiRow = aiRec ? htsIndex.get(aiRec) : undefined;
      if (!aiRow) continue;

      pairs.push({
        query: userQuery.slice(0, 200),
        positive,
        negatives: [this.buildCandidateText(aiRow)],
      });
      feedbackPairs++;
    }

    if (feedbackPairs > 0) {
      this.logger.log(`Added ${feedbackPairs} feedback correction pairs (total=${pairs.length})`);
    }

    // Write to temp file
    const outPath = join(tmpdir(), `reranker-retrain-${runId}.jsonl`);
    const content = pairs.map((p) => JSON.stringify(p)).join('\n') + '\n';
    await writeFile(outPath, content, 'utf-8');

    return { path: outPath, pairs: pairs.length, feedbackPairs };
  }

  async uploadToDgx(localPath: string): Promise<void> {
    const dest = `${this.sshUser}@${this.sshHost}:${this.dgxTrainingDataPath}`;
    await execAsync(`scp -o ConnectTimeout=30 -o StrictHostKeyChecking=no "${localPath}" "${dest}"`);
  }

  async startTrainingOnDgx(sentinelFile: string): Promise<void> {
    // Start training in background; create sentinel file when done
    const cmd = [
      `nohup python3 ${this.dgxTrainScript}`,
      `> ${this.dgxLogPath} 2>&1`,
      `&& touch ${sentinelFile}`,
      `|| touch ${sentinelFile}-failed`,
      `&`,
    ].join(' ');
    await this.ssh(cmd);
  }

  async pollForCompletion(sentinelFile: string): Promise<boolean> {
    const deadline = Date.now() + this.timeoutMs;
    let tick = 0;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      tick++;

      try {
        const result = await this.ssh(
          `test -f ${sentinelFile}-failed && echo FAILED; test -f ${sentinelFile} && echo DONE; true`,
        );
        if (result.includes('FAILED')) {
          throw new Error(`Training script exited with error on DGX. Check ${this.dgxLogPath}`);
        }
        if (result.includes('DONE')) {
          return true;
        }
        const elapsed = Math.round((tick * this.pollIntervalMs) / 60_000);
        this.logger.log(`Training still running on DGX (elapsed ~${elapsed} min)`);
      } catch (err) {
        if ((err as Error).message.includes('Training script exited')) throw err;
        this.logger.warn(`SSH poll error (will retry): ${(err as Error).message}`);
      }
    }

    return false;
  }

  async restartRerankerService(): Promise<void> {
    await this.ssh(
      `docker compose -f ${this.dgxComposeFile} restart reranker-service`,
    );
  }

  async verifyHealth(): Promise<void> {
    // Give the container a moment to come up
    await new Promise((r) => setTimeout(r, 10_000));

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        const health = await this.dgxReranker.checkHealth();
        if (health.model_loaded) return;
        throw new Error(`Health check returned model_loaded=false`);
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(`Health check attempt ${attempt}/6 failed: ${lastError.message}`);
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
    throw new Error(`Reranker service health check failed after restart: ${lastError?.message}`);
  }

  // ─── Training data helpers (ported from export-reranker-training-data.ts) ──

  private buildCandidateText(row: HtsRow): string {
    const breadcrumb = ((row.full_description ?? []) as string[]).slice(-2).join(' › ');
    const title = row.description ?? '';
    return `${row.hts_number} | ${title} | ${breadcrumb}`.slice(0, 400);
  }

  private buildQuery(row: HtsRow): string {
    const hierarchy = (row.full_description ?? []) as string[];
    const parts = [...hierarchy.slice(-1), row.description ?? '']
      .map((p) => p.trim())
      .filter(Boolean);
    return [...new Set(parts)].join(' ').slice(0, 200).trim();
  }

  /** Deterministic Fisher-Yates shuffle seeded by string (matches the CLI script exactly). */
  private shuffleDeterministic<T>(arr: T[], seed: string): T[] {
    const copy = [...arr];
    let state = seed.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffffffff, 1);
    const rand = (): number => {
      state ^= state << 13;
      state ^= state >> 17;
      state ^= state << 5;
      return (state >>> 0) / 0xffffffff;
    };
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // ─── SSH helper ──────────────────────────────────────────────────────────────

  private async ssh(command: string): Promise<string> {
    const opts = [
      '-o ConnectTimeout=15',
      '-o ServerAliveInterval=30',
      '-o StrictHostKeyChecking=no',
    ].join(' ');
    const { stdout } = await execAsync(
      `ssh ${opts} ${this.sshUser}@${this.sshHost} ${JSON.stringify(command)}`,
    );
    return stdout.trim();
  }
}
