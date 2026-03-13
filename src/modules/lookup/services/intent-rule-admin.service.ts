import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { parse as csvParse } from 'csv-parse/sync';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { LookupIntentRuleEntity } from '../entities/lookup-intent-rule.entity';
import { LookupTestSampleEntity } from '../entities/lookup-test-sample.entity';
import { IntentRuleService } from './intent-rule.service';
import { IntentRule } from './intent-rules';
import { OpenAiService } from '../../../core/services/openai.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any;

interface HtsGroup {
  htsCode: string;
  descriptions: string[];
}

export interface CsvImportStatus {
  jobId: string;
  status: 'processing' | 'completed' | 'failed';
  totalGroups: number;
  processedGroups: number;
  imported: number;
  skipped: number;
  errorMessage?: string;
  startedAt: Date;
  completedAt?: Date;
}

export interface IntentRuleListItem {
  id: string;
  ruleId: string;
  description: string;
  pattern: Record<string, unknown>;
  inject: Record<string, unknown>[] | null;
  whitelist: Record<string, unknown> | null;
  boosts: Record<string, unknown>[] | null;
  penalties: Record<string, unknown>[] | null;
  lexicalFilter: Record<string, unknown> | null;
  enabled: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestSampleListItem {
  id: string;
  htsNumber: string;
  query: string;
  source: string;
  createdAt: Date;
}

@Injectable()
export class IntentRuleAdminService {
  private readonly logger = new Logger(IntentRuleAdminService.name);
  private readonly importJobs = new Map<string, CsvImportStatus>();

  constructor(
    @InjectRepository(LookupIntentRuleEntity)
    private readonly ruleRepo: Repository<LookupIntentRuleEntity>,
    @InjectRepository(LookupTestSampleEntity)
    private readonly sampleRepo: Repository<LookupTestSampleEntity>,
    private readonly intentRuleService: IntentRuleService,
    private readonly openAiService: OpenAiService,
  ) {}

  /** List rules with pagination and optional search/enabled filter. */
  async listRules(
    page: number,
    pageSize: number,
    search?: string,
    enabled?: boolean,
  ): Promise<{ data: IntentRuleListItem[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (enabled !== undefined) where.enabled = enabled;
    if (search) {
      const [data, total] = await this.ruleRepo.findAndCount({
        where: [
          { ...where, ruleId: ILike(`%${search}%`) },
          { ...where, description: ILike(`%${search}%`) },
        ],
        order: { priority: 'ASC', createdAt: 'ASC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { data: data as IntentRuleListItem[], total };
    }
    const [data, total] = await this.ruleRepo.findAndCount({
      where,
      order: { priority: 'ASC', createdAt: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { data: data as IntentRuleListItem[], total };
  }

  /** Get a single rule by ruleId. */
  async getRule(ruleId: string): Promise<LookupIntentRuleEntity> {
    const rule = await this.ruleRepo.findOne({ where: { ruleId } });
    if (!rule) throw new NotFoundException(`Rule ${ruleId} not found`);
    return rule;
  }

  /** Create or update a rule. */
  async upsertRule(rule: IntentRule, priority = 0): Promise<void> {
    await this.intentRuleService.upsertRule(rule, priority);
    this.logger.log(`Upserted rule: ${rule.id}`);
  }

  /** Update specific fields on an existing rule. */
  async updateRule(ruleId: string, partial: Partial<IntentRule> & { priority?: number }): Promise<void> {
    const existing = await this.ruleRepo.findOne({ where: { ruleId } });
    if (!existing) throw new NotFoundException(`Rule ${ruleId} not found`);

    const { priority, ...ruleFields } = partial;
    await this.ruleRepo.update(
      { ruleId },
      {
        ...(ruleFields.description !== undefined ? { description: ruleFields.description } : {}),
        ...(ruleFields.pattern !== undefined ? { pattern: ruleFields.pattern as JsonValue } : {}),
        ...(ruleFields.lexicalFilter !== undefined ? { lexicalFilter: (ruleFields.lexicalFilter ?? null) as JsonValue } : {}),
        ...(ruleFields.inject !== undefined ? { inject: (ruleFields.inject ?? null) as JsonValue } : {}),
        ...(ruleFields.whitelist !== undefined ? { whitelist: (ruleFields.whitelist ?? null) as JsonValue } : {}),
        ...(ruleFields.boosts !== undefined ? { boosts: (ruleFields.boosts ?? null) as JsonValue } : {}),
        ...(ruleFields.penalties !== undefined ? { penalties: (ruleFields.penalties ?? null) as JsonValue } : {}),
        ...(priority !== undefined ? { priority } : {}),
      },
    );
    await this.intentRuleService.reload();
    this.logger.log(`Updated rule: ${ruleId}`);
  }

  /** Toggle enabled/disabled on a rule. */
  async toggleRule(ruleId: string): Promise<{ enabled: boolean }> {
    const rule = await this.ruleRepo.findOne({ where: { ruleId } });
    if (!rule) throw new NotFoundException(`Rule ${ruleId} not found`);
    const newEnabled = !rule.enabled;
    await this.ruleRepo.update({ ruleId }, { enabled: newEnabled });
    await this.intentRuleService.reload();
    this.logger.log(`Toggled rule ${ruleId}: enabled=${newEnabled}`);
    return { enabled: newEnabled };
  }

  /** Disable a rule (soft delete). */
  async removeRule(ruleId: string): Promise<void> {
    const rule = await this.ruleRepo.findOne({ where: { ruleId } });
    if (!rule) throw new NotFoundException(`Rule ${ruleId} not found`);
    await this.intentRuleService.disableRule(ruleId);
    this.logger.log(`Disabled rule: ${ruleId}`);
  }

  // ── Test Samples ──────────────────────────────────────────────────────────

  /** List samples with optional HTS number filter. */
  async listSamples(
    page: number,
    pageSize: number,
    htsNumber?: string,
  ): Promise<{ data: TestSampleListItem[]; total: number }> {
    const where = htsNumber ? { htsNumber } : {};
    const [data, total] = await this.sampleRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { data: data as TestSampleListItem[], total };
  }

  /** Add a manual test sample. */
  async addSample(htsNumber: string, query: string): Promise<TestSampleListItem> {
    const entity = this.sampleRepo.create({ htsNumber, query, source: 'manual' });
    const saved = await this.sampleRepo.save(entity);
    this.logger.log(`Added manual sample for ${htsNumber}: "${query}"`);
    return saved as TestSampleListItem;
  }

  /** Update a test sample's HTS number and/or query. */
  async updateSample(id: string, htsNumber?: string, query?: string): Promise<TestSampleListItem> {
    const entity = await this.sampleRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Sample ${id} not found`);
    if (htsNumber !== undefined) entity.htsNumber = htsNumber;
    if (query !== undefined) entity.query = query;
    const saved = await this.sampleRepo.save(entity);
    this.logger.log(`Updated sample ${id}`);
    return saved as TestSampleListItem;
  }

  /** Delete a test sample by ID. */
  async deleteSample(id: string): Promise<void> {
    const result = await this.sampleRepo.delete({ id });
    if (result.affected === 0) throw new NotFoundException(`Sample ${id} not found`);
    this.logger.log(`Deleted sample: ${id}`);
  }

  /**
   * Start an AI-powered async CSV import.
   * Returns a jobId immediately; processing runs in background.
   * Handles messy real-world CSVs: mixed dot formats, HTML in descriptions, near-duplicates.
   */
  async startCsvImport(buffer: Buffer): Promise<{ jobId: string; rawRows: number; uniqueGroups: number }> {
    const records = this.parseCsvRecords(buffer);
    if (!records.length) throw new BadRequestException('CSV file is empty');

    const groups = this.normalizeAndGroup(records);
    if (!groups.length) throw new BadRequestException('No valid HTS codes found in CSV (expected 10-digit codes)');

    const jobId = randomUUID();
    const status: CsvImportStatus = {
      jobId,
      status: 'processing',
      totalGroups: groups.length,
      processedGroups: 0,
      imported: 0,
      skipped: 0,
      startedAt: new Date(),
    };
    this.importJobs.set(jobId, status);

    // Run in background — do NOT await
    this.runImportJob(jobId, groups).catch((err: Error) => {
      const s = this.importJobs.get(jobId);
      if (s) {
        s.status = 'failed';
        s.errorMessage = err.message;
        s.completedAt = new Date();
      }
    });

    return { jobId, rawRows: records.length, uniqueGroups: groups.length };
  }

  /** Get the current status of an async CSV import job. */
  getImportStatus(jobId: string): CsvImportStatus | null {
    return this.importJobs.get(jobId) ?? null;
  }

  // ── Private: CSV parsing ───────────────────────────────────────────────────

  private parseCsvRecords(buffer: Buffer): Record<string, string>[] {
    try {
      return csvParse(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true,
      }) as Record<string, string>[];
    } catch {
      throw new BadRequestException('Invalid CSV file — could not parse');
    }
  }

  /**
   * Normalize HTS codes and group descriptions by code.
   * - Strips dots/spaces/dashes from codes, requires exactly 10 digits
   * - Strips HTML tags from descriptions
   * - Deduplicates descriptions case-insensitively within each group
   */
  private normalizeAndGroup(records: Record<string, string>[]): HtsGroup[] {
    const groupMap = new Map<string, Set<string>>();
    let skipped = 0;

    for (const row of records) {
      // Flexible column detection — handles many real-world CSV schemas
      const rawCode =
        row['hts_code'] ?? row['hts_number'] ?? row['htsNumber'] ??
        row['HTS Code'] ?? row['HTS Number'] ?? row['code'] ?? '';
      const rawDesc =
        row['custom_description'] ?? row['description'] ?? row['query'] ??
        row['Query'] ?? row['Description'] ?? row['product_description'] ?? '';

      // Normalize code: keep digits only, must be exactly 10
      const normalizedCode = rawCode.replace(/[^0-9]/g, '');
      if (normalizedCode.length !== 10) {
        skipped++;
        continue;
      }

      // Strip HTML tags, collapse whitespace
      const cleanDesc = rawDesc
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleanDesc) continue;

      if (!groupMap.has(normalizedCode)) groupMap.set(normalizedCode, new Set());

      // Case-insensitive exact dedup
      const set = groupMap.get(normalizedCode)!;
      const lower = cleanDesc.toLowerCase();
      const alreadyExists = [...set].some(s => s.toLowerCase() === lower);
      if (!alreadyExists) set.add(cleanDesc);
    }

    this.logger.log(`normalizeAndGroup: ${groupMap.size} unique HTS codes, ${skipped} rows skipped (invalid code)`);
    return [...groupMap.entries()].map(([htsCode, descs]) => ({
      htsCode,
      descriptions: [...descs],
    }));
  }

  // ── Private: background processing ────────────────────────────────────────

  private async runImportJob(jobId: string, groups: HtsGroup[]): Promise<void> {
    const status = this.importJobs.get(jobId)!;
    const BATCH_SIZE = 5;
    const MAX_DESCS_PER_CODE = 30; // cap to keep prompts manageable

    for (let i = 0; i < groups.length; i += BATCH_SIZE) {
      const batch = groups.slice(i, i + BATCH_SIZE);

      // Groups with ≤3 descriptions skip AI (already clean enough after HTML strip + dedup)
      const simpleGroups = batch.filter(g => g.descriptions.length <= 3);
      const complexGroups = batch.filter(g => g.descriptions.length > 3);

      try {
        // Save simple groups directly
        if (simpleGroups.length > 0) {
          const entities = simpleGroups.flatMap(g =>
            g.descriptions.map(q =>
              this.sampleRepo.create({ htsNumber: g.htsCode, query: q, source: 'csv' }),
            ),
          );
          await this.sampleRepo.save(entities);
          status.imported += entities.length;
        }

        // Use AI to deduplicate + clean complex groups
        if (complexGroups.length > 0) {
          const aiResults = await this.extractQueriesWithAI(complexGroups, MAX_DESCS_PER_CODE);
          const entities = aiResults.flatMap(({ htsCode, queries }) =>
            queries.map(q =>
              this.sampleRepo.create({ htsNumber: htsCode, query: q, source: 'csv' }),
            ),
          );
          if (entities.length > 0) {
            await this.sampleRepo.save(entities);
            status.imported += entities.length;
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Import batch ${i}–${i + BATCH_SIZE} failed: ${msg}`);
        // Fallback: save first 5 descriptions from each group without AI
        for (const g of batch) {
          try {
            const fallback = g.descriptions.slice(0, 5).map(q =>
              this.sampleRepo.create({ htsNumber: g.htsCode, query: q, source: 'csv' }),
            );
            await this.sampleRepo.save(fallback);
            status.imported += fallback.length;
          } catch {
            status.skipped += g.descriptions.length;
          }
        }
      }

      status.processedGroups += batch.length;
    }

    status.status = 'completed';
    status.completedAt = new Date();
    this.logger.log(`CSV import job ${jobId} completed: ${status.imported} imported, ${status.skipped} skipped`);
  }

  /**
   * Call AI to extract 3–5 clean, diverse search queries from raw product descriptions.
   * Batches multiple HTS codes in one API call for efficiency.
   */
  private async extractQueriesWithAI(
    groups: HtsGroup[],
    maxDescsPerCode: number,
  ): Promise<{ htsCode: string; queries: string[] }[]> {
    const payload = groups.map(g => ({
      code: g.htsCode,
      descriptions: g.descriptions.slice(0, maxDescsPerCode),
    }));

    const input = `You are an HTS trade classification assistant. For each HTS code below, analyze the raw product descriptions from customs shipments and return 3-5 clean, concise search queries that a user would type to find this product type.

Rules:
- Remove brand names, model numbers, size variants, weights, counts, pack quantities
- Strip any remaining HTML
- Each query should be 2-6 plain English words
- Make queries diverse: different aspects, synonyms, use cases
- Do not include near-duplicate queries
- Focus on the core product type and material/composition

HTS codes and their raw descriptions (json):
${JSON.stringify(payload)}

Respond in JSON format: [{"code":"XXXXXXXXXX","queries":["query 1","query 2","query 3"]}]`;

    try {
      const res = await this.openAiService.response(input, {
        model: 'gpt-4.1-nano',
        text: { format: { type: 'json_object' } },
      });

      const parsed: unknown = JSON.parse(res.output_text);
      const arr: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as Record<string, unknown>)['results'])
          ? ((parsed as Record<string, unknown>)['results'] as unknown[])
          : [];

      return arr
        .filter((item): item is { code: string; queries: string[] } =>
          typeof (item as Record<string, unknown>)['code'] === 'string' &&
          Array.isArray((item as Record<string, unknown>)['queries']),
        )
        .map(item => ({
          htsCode: item.code,
          queries: (item.queries as unknown[])
            .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
            .map(q => q.trim()),
        }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`AI extraction failed (${msg}), falling back to first 5 descriptions`);
      // Fallback: return first 5 cleaned descriptions per group
      return groups.map(g => ({
        htsCode: g.htsCode,
        queries: g.descriptions.slice(0, 5),
      }));
    }
  }
}
