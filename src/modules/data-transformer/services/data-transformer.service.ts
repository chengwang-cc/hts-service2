import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import {
  DataTransformerMappingEntity,
  DataTransformerProfileEntity,
  DataTransformerRunEntity,
  DataTransformerRunIssueEntity,
} from '../entities';

export interface CreateProfileInput {
  name: string;
  description?: string;
  inputKind: string;
  outputKind: string;
  inputSchema: Record<string, unknown>;
  defaults?: Record<string, unknown>;
}

export interface SaveMappingInput {
  sourceField: string;
  targetField: string;
  transform?: Record<string, unknown> | null;
  required?: boolean;
  notes?: string;
}

export interface SchemaInferenceResult {
  columns: Array<{
    name: string;
    inferredType: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'object' | 'null';
    nullable: boolean;
    sampleValues: unknown[];
  }>;
  rowCount: number;
}

export interface TransformRunInput {
  profileId: string;
  rows: Array<Record<string, unknown>>;
  triggeredBy?: string;
}

export interface TransformRunResult {
  runId: string;
  status: 'succeeded' | 'failed' | 'partial';
  outputRows: Array<Record<string, unknown>>;
  issues: Array<{
    severity: 'info' | 'warning' | 'error';
    rowIndex: number | null;
    field: string | null;
    message: string;
  }>;
}

@Injectable()
export class DataTransformerService {
  private readonly logger = new Logger(DataTransformerService.name);

  constructor(
    @InjectRepository(DataTransformerProfileEntity)
    private readonly profiles: Repository<DataTransformerProfileEntity>,
    @InjectRepository(DataTransformerMappingEntity)
    private readonly mappings: Repository<DataTransformerMappingEntity>,
    @InjectRepository(DataTransformerRunEntity)
    private readonly runs: Repository<DataTransformerRunEntity>,
    @InjectRepository(DataTransformerRunIssueEntity)
    private readonly issues: Repository<DataTransformerRunIssueEntity>,
  ) {}

  /**
   * Infer column types from a sampling of rows. Conservative — falls
   * back to `string` when types disagree. Operators can override the
   * inferred schema before saving the profile.
   */
  inferSchema(
    rows: Array<Record<string, unknown>>,
  ): SchemaInferenceResult {
    if (!Array.isArray(rows)) {
      throw new BadRequestException('inferSchema requires a row array');
    }
    const columnNames = new Set<string>();
    for (const row of rows.slice(0, 200)) {
      for (const key of Object.keys(row ?? {})) columnNames.add(key);
    }
    const columns: SchemaInferenceResult['columns'] = [];
    for (const name of columnNames) {
      const types = new Set<string>();
      const samples: unknown[] = [];
      let seenNull = false;
      for (const row of rows.slice(0, 50)) {
        const value = (row as any)[name];
        if (value === null || value === undefined) {
          seenNull = true;
          continue;
        }
        types.add(detectType(value));
        if (samples.length < 3) samples.push(value);
      }
      const inferredType =
        types.size === 1
          ? (types.values().next().value as SchemaInferenceResult['columns'][number]['inferredType'])
          : 'string';
      columns.push({
        name,
        inferredType,
        nullable: seenNull,
        sampleValues: samples,
      });
    }
    return { columns, rowCount: rows.length };
  }

  async createProfile(
    organizationId: string,
    actor: string,
    input: CreateProfileInput,
  ): Promise<DataTransformerProfileEntity> {
    if (!input.name?.trim()) {
      throw new BadRequestException('profile requires a name');
    }
    const row = this.profiles.create({
      organizationId,
      name: input.name.trim(),
      description: input.description ?? null,
      inputKind: input.inputKind,
      outputKind: input.outputKind,
      inputSchema: input.inputSchema,
      defaults: input.defaults ?? {},
      createdBy: actor,
      updatedBy: actor,
    });
    return this.profiles.save(row);
  }

  async listProfiles(
    organizationId: string,
  ): Promise<DataTransformerProfileEntity[]> {
    return this.profiles.find({
      where: { organizationId },
      order: { updatedAt: 'DESC' },
      take: 200,
    });
  }

  async listMappings(
    organizationId: string,
    profileId: string,
  ): Promise<DataTransformerMappingEntity[]> {
    await this.requireProfile(organizationId, profileId);
    return this.mappings.find({
      where: { profileId },
      order: { targetField: 'ASC' },
    });
  }

  async saveMappings(
    organizationId: string,
    profileId: string,
    inputs: SaveMappingInput[],
  ): Promise<DataTransformerMappingEntity[]> {
    await this.requireProfile(organizationId, profileId);
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new BadRequestException('saveMappings requires at least one mapping');
    }
    // Replace-all semantics keeps the mapping editor simple — fewer
    // partial-state foot-guns. The whole save is wrapped in a transaction
    // via repository chain (single profile scope).
    await this.mappings.delete({ profileId });
    const rows = inputs.map((input) =>
      this.mappings.create({
        profileId,
        sourceField: input.sourceField.trim(),
        targetField: input.targetField.trim(),
        transform: input.transform ?? null,
        required: input.required ?? false,
        notes: input.notes ?? null,
      }),
    );
    return this.mappings.save(rows);
  }

  /**
   * Run a transform over an inline row batch. The output structure is
   * driven by `profile.outputKind` (the planner can post-process per-
   * output-kind later). For the POC, the output is a list of
   * `{targetField: value}` rows + per-row issue records.
   */
  async run(
    organizationId: string,
    input: TransformRunInput,
  ): Promise<TransformRunResult> {
    const profile = await this.requireProfile(organizationId, input.profileId);
    const mappings = await this.mappings.find({
      where: { profileId: profile.id },
    });
    if (!mappings.length) {
      throw new BadRequestException(
        'profile has no mappings; configure at least one before running',
      );
    }
    const run = this.runs.create({
      organizationId,
      profileId: profile.id,
      status: 'running',
      inputRowCount: input.rows.length,
      outputRowCount: 0,
      issueCount: 0,
      triggeredBy: input.triggeredBy ?? 'system',
    });
    const savedRun = await this.runs.save(run);

    const outputRows: Array<Record<string, unknown>> = [];
    const issues: TransformRunResult['issues'] = [];
    let errorCount = 0;
    for (let i = 0; i < input.rows.length; i += 1) {
      const sourceRow = input.rows[i] ?? {};
      const targetRow: Record<string, unknown> = {
        ...(profile.defaults ?? {}),
      };
      let rowFailed = false;
      for (const mapping of mappings) {
        const sourceValue = (sourceRow as any)[mapping.sourceField];
        if (mapping.required && (sourceValue === undefined || sourceValue === null || sourceValue === '')) {
          issues.push({
            severity: 'error',
            rowIndex: i,
            field: mapping.targetField,
            message: `required source field "${mapping.sourceField}" is empty`,
          });
          rowFailed = true;
          continue;
        }
        try {
          targetRow[mapping.targetField] = applyTransform(
            sourceValue,
            mapping.transform,
            sourceRow,
          );
        } catch (e: any) {
          issues.push({
            severity: 'error',
            rowIndex: i,
            field: mapping.targetField,
            message: e?.message ?? String(e),
          });
          rowFailed = true;
        }
      }
      if (rowFailed) errorCount += 1;
      else outputRows.push(targetRow);
    }

    // Persist issues + finalize run.
    if (issues.length) {
      await this.issues.save(
        issues.map((issue) =>
          this.issues.create({
            runId: savedRun.id,
            severity: issue.severity,
            rowIndex: issue.rowIndex,
            field: issue.field,
            message: issue.message,
            context: null,
          }),
        ),
      );
    }
    const status: TransformRunResult['status'] =
      errorCount === 0
        ? 'succeeded'
        : errorCount === input.rows.length
          ? 'failed'
          : 'partial';
    savedRun.status = status;
    savedRun.outputRowCount = outputRows.length;
    savedRun.issueCount = issues.length;
    savedRun.output = { outputKind: profile.outputKind, rows: outputRows };
    await this.runs.save(savedRun);
    return { runId: savedRun.id, status, outputRows, issues };
  }

  async listRuns(
    organizationId: string,
    profileId?: string,
  ): Promise<DataTransformerRunEntity[]> {
    return this.runs.find({
      where: {
        organizationId,
        ...(profileId ? { profileId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async getRunIssues(
    organizationId: string,
    runId: string,
  ): Promise<DataTransformerRunIssueEntity[]> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run || run.organizationId !== organizationId) {
      throw new NotFoundException('run not found');
    }
    return this.issues.find({
      where: { runId: run.id },
      order: { createdAt: 'ASC' },
      take: 500,
    });
  }

  private async requireProfile(
    organizationId: string,
    profileId: string,
  ): Promise<DataTransformerProfileEntity> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile || profile.organizationId !== organizationId) {
      throw new NotFoundException('transformer profile not found');
    }
    return profile;
  }
}

function detectType(value: unknown): SchemaInferenceResult['columns'][number]['inferredType'] {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') {
    if (!Number.isNaN(Number(value)) && value.trim() !== '') {
      return Number.isInteger(Number(value)) ? 'integer' : 'number';
    }
    if (!Number.isNaN(Date.parse(value)) && /\d{4}/.test(value)) {
      return 'date';
    }
    return 'string';
  }
  return 'string';
}

function applyTransform(
  value: unknown,
  transform: Record<string, unknown> | null,
  sourceRow: Record<string, unknown>,
): unknown {
  if (!transform) return value;
  const op = String(transform.op ?? '').toLowerCase();
  switch (op) {
    case 'upper':
      return value == null ? value : String(value).toUpperCase();
    case 'lower':
      return value == null ? value : String(value).toLowerCase();
    case 'trim':
      return value == null ? value : String(value).trim();
    case 'number': {
      if (value === null || value === undefined || value === '') return null;
      const n = Number(value);
      if (Number.isNaN(n)) throw new Error(`cannot parse "${value}" as number`);
      return n;
    }
    case 'integer': {
      if (value === null || value === undefined || value === '') return null;
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new Error(`cannot parse "${value}" as integer`);
      }
      return n;
    }
    case 'date': {
      if (value === null || value === undefined || value === '') return null;
      const d = new Date(value as any);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`cannot parse "${value}" as date`);
      }
      return d.toISOString();
    }
    case 'concat': {
      const fields = Array.isArray(transform.fields)
        ? (transform.fields as string[])
        : [];
      const sep = typeof transform.sep === 'string' ? transform.sep : ' ';
      const parts = fields
        .map((f) => sourceRow[f])
        .filter((v) => v !== null && v !== undefined && v !== '')
        .map((v) => String(v));
      return parts.join(sep);
    }
    case 'default': {
      if (value !== null && value !== undefined && value !== '') return value;
      return (transform.value ?? null) as unknown;
    }
    case 'map': {
      const table = (transform.table ?? {}) as Record<string, unknown>;
      const key = String(value ?? '');
      if (Object.prototype.hasOwnProperty.call(table, key)) {
        return table[key];
      }
      return transform.fallback ?? value ?? null;
    }
    case 'constant':
      return (transform.value ?? null) as unknown;
    default:
      throw new Error(`unsupported transform op: ${op}`);
  }
}
