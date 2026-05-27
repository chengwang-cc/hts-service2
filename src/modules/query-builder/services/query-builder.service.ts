import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import {
  KnowledgeQueryCitation,
  KnowledgeQueryService,
} from '../../knowledgebase-cards/services/knowledge-query.service';
import {
  QueryBuilderInputDto,
  QUERY_OUTPUTS,
} from '../dto/query-builder.dto';
import { QueryBuilderTemplateEntity } from '../entities/query-builder-template.entity';
import { QueryBuilderSynthesizerService } from './query-builder-synthesizer.service';

/**
 * Planner output — what sources will be queried + an explanation an
 * operator can review before running the (potentially expensive) AI
 * synthesis pass.
 */
export interface QueryBuilderPlan {
  jurisdictions: string[];
  documentTypes: string[];
  sourceIds: string[];
  filters: Record<string, unknown>;
  estimatedCitations: number;
  estimatedCostUsd: number;
  warnings: string[];
}

export interface QueryBuilderRunResult {
  plan: QueryBuilderPlan;
  answer: string;
  answerSource: 'ai' | 'deterministic';
  citations: KnowledgeQueryCitation[];
  missingInformation: string[];
  nextActions: string[];
  confidence: number;
  freshnessHours: number | null;
  generatedAt: string;
}

/**
 * QueryBuilderService.
 *
 * The planner is deterministic and works from the structured input:
 * it derives jurisdictions/documentTypes from role + countries + ruleArea,
 * delegates to KnowledgeQueryService for retrieval, then assembles a
 * cited answer. AI synthesis is intentionally pluggable — when no AI
 * provider is bound, we return a deterministic "stitched citations"
 * answer so callers see real content (and tests work).
 */
@Injectable()
export class QueryBuilderService {
  private readonly logger = new Logger(QueryBuilderService.name);

  constructor(
    @InjectRepository(QueryBuilderTemplateEntity)
    private readonly templates: Repository<QueryBuilderTemplateEntity>,
    private readonly knowledge: KnowledgeQueryService,
    @Optional() private readonly synthesizer: QueryBuilderSynthesizerService | null = null,
  ) {}

  async plan(input: QueryBuilderInputDto): Promise<QueryBuilderPlan> {
    this.validateInput(input);
    const jurisdictions = uniqueUpper(
      [input.originCountry, input.destinationCountry].filter(
        (v): v is string => !!v,
      ),
    );
    const documentTypes = documentTypesForRule(input.ruleArea);
    const filters: Record<string, unknown> = {
      role: input.role,
      hts: input.hts ?? null,
      effectiveAt: input.effectiveAt ?? null,
      certaintyThreshold: input.certaintyThreshold ?? 60,
    };
    const warnings: string[] = [];
    if (!input.hts && /tariff|duty|cbam|exclusion/i.test(input.ruleArea ?? '')) {
      warnings.push(
        'No HTS code provided. Result accuracy improves significantly with an HTS code for tariff/duty/CBAM questions.',
      );
    }
    if (!jurisdictions.length) {
      warnings.push(
        'No origin or destination country provided. Planner will return jurisdiction-agnostic results.',
      );
    }
    return {
      jurisdictions,
      documentTypes,
      sourceIds: input.sourceIds ?? [],
      filters,
      estimatedCitations: 10,
      estimatedCostUsd: 0,
      warnings,
    };
  }

  async run(input: QueryBuilderInputDto): Promise<QueryBuilderRunResult> {
    const plan = await this.plan(input);
    const citations: KnowledgeQueryCitation[] = [];
    const seen = new Set<string>();
    const targets =
      plan.jurisdictions.length > 0 ? plan.jurisdictions : [undefined];
    for (const jurisdiction of targets) {
      for (const docType of plan.documentTypes.length
        ? plan.documentTypes
        : [undefined]) {
        const result = await this.knowledge.query({
          jurisdiction,
          documentType: docType,
          limit: 25,
          effectiveBefore: input.effectiveAt
            ? new Date(input.effectiveAt)
            : undefined,
        });
        for (const c of result.cards) {
          if (!seen.has(c.cardId)) {
            seen.add(c.cardId);
            citations.push(c);
          }
        }
      }
    }
    citations.sort(
      (a, b) =>
        (a.sourceFreshnessHours ?? Number.POSITIVE_INFINITY) -
        (b.sourceFreshnessHours ?? Number.POSITIVE_INFINITY),
    );
    const top = citations.slice(0, plan.estimatedCitations);
    const outputs = new Set(input.outputs ?? QUERY_OUTPUTS);

    let answer = '';
    let answerSource: QueryBuilderRunResult['answerSource'] = 'deterministic';
    if (outputs.has('answer')) {
      const aiAnswer = this.synthesizer?.isAvailable()
        ? await this.synthesizer.synthesize(input, top)
        : null;
      if (aiAnswer) {
        answer = aiAnswer;
        answerSource = 'ai';
      } else {
        answer = this.deterministicAnswer(input, top);
      }
    }

    const missingInformation = outputs.has('missing_information')
      ? this.detectMissingInformation(input)
      : [];
    const nextActions = outputs.has('next_actions')
      ? this.suggestNextActions(input, top)
      : [];
    const confidence = computeConfidence(top, plan);
    return {
      plan,
      answer,
      answerSource,
      citations: outputs.has('citations') ? top : [],
      missingInformation,
      nextActions,
      confidence,
      freshnessHours:
        top.length > 0
          ? Math.min(
              ...top
                .map((c) => c.sourceFreshnessHours)
                .filter((v): v is number => typeof v === 'number'),
              Number.POSITIVE_INFINITY,
            )
          : null,
      generatedAt: new Date().toISOString(),
    };
  }

  async listTemplates(
    organizationId: string | null,
  ): Promise<QueryBuilderTemplateEntity[]> {
    return this.templates.find({
      where: organizationId ? { organizationId } : {},
      order: { updatedAt: 'DESC' },
      take: 100,
    });
  }

  async saveTemplate(
    organizationId: string | null,
    actor: string,
    input: {
      name: string;
      description?: string;
      input: QueryBuilderInputDto;
    },
  ): Promise<QueryBuilderTemplateEntity> {
    if (!input.name?.trim()) {
      throw new BadRequestException('template requires a name');
    }
    const row = this.templates.create({
      organizationId,
      name: input.name.trim(),
      description: input.description ?? null,
      input: input.input as unknown as Record<string, unknown>,
      createdBy: actor,
      updatedBy: actor,
    });
    return this.templates.save(row);
  }

  async deleteTemplate(
    organizationId: string | null,
    id: string,
  ): Promise<void> {
    const row = await this.templates.findOne({ where: { id } });
    if (!row) throw new NotFoundException('template not found');
    if (row.organizationId && row.organizationId !== organizationId) {
      throw new NotFoundException('template not found');
    }
    await this.templates.delete({ id });
  }

  private validateInput(input: QueryBuilderInputDto): void {
    if (!input.question?.trim()) {
      throw new BadRequestException('question is required');
    }
  }

  private deterministicAnswer(
    input: QueryBuilderInputDto,
    citations: KnowledgeQueryCitation[],
  ): string {
    if (citations.length === 0) {
      return `No active knowledge cards match this query yet. The crawler has not indexed authoritative guidance for ${
        input.ruleArea ?? input.question.slice(0, 80)
      }${input.originCountry ? ` from ${input.originCountry}` : ''}${
        input.destinationCountry ? ` to ${input.destinationCountry}` : ''
      }.`;
    }
    const lines = [
      `Based on ${citations.length} cited source(s), here are the most relevant guidance excerpts for: "${input.question.slice(0, 200)}".`,
      '',
      ...citations.slice(0, 5).map((c, i) =>
        `${i + 1}. [${c.cardKey}] (${c.jurisdiction ?? 'unknown jurisdiction'}, ${c.documentType}) — ${c.excerpt}`,
      ),
    ];
    return lines.join('\n');
  }

  private detectMissingInformation(input: QueryBuilderInputDto): string[] {
    const missing: string[] = [];
    if (!input.hts) {
      missing.push('hts');
    }
    if (!input.originCountry) {
      missing.push('originCountry');
    }
    if (!input.destinationCountry) {
      missing.push('destinationCountry');
    }
    if (!input.effectiveAt) {
      missing.push('effectiveAt');
    }
    if (!input.productDescription) {
      missing.push('productDescription');
    }
    return missing;
  }

  private suggestNextActions(
    input: QueryBuilderInputDto,
    citations: KnowledgeQueryCitation[],
  ): string[] {
    const actions: string[] = [];
    if (citations.length === 0) {
      actions.push(
        'Add an authoritative source for this jurisdiction in /admin/knowledgebase/sources',
      );
    }
    const stale = citations.find(
      (c) =>
        c.sourceFreshnessHours !== null && c.sourceFreshnessHours > 24 * 14,
    );
    if (stale) {
      actions.push(
        `Re-crawl ${stale.cardKey} (source last refreshed ${stale.sourceFreshnessHours} hours ago)`,
      );
    }
    if (!input.hts && input.role === 'broker') {
      actions.push('Classify the shipment with /classify to attach an HTS code, then re-run');
    }
    return actions;
  }
}

function uniqueUpper(items: string[]): string[] {
  const out = new Set<string>();
  for (const item of items) {
    if (item) out.add(item.toUpperCase());
  }
  return Array.from(out);
}

function documentTypesForRule(area: string | undefined): string[] {
  if (!area) return [];
  const lower = area.toLowerCase();
  if (lower.includes('csms')) return ['csms'];
  if (lower.includes('cbam')) return ['eu-regulation'];
  if (lower.includes('ustr') || lower.includes('exclusion')) return ['fr-notice'];
  if (lower.includes('tariff')) return ['tariff-schedule'];
  if (lower.includes('ruling')) return ['ruling'];
  return [];
}

function computeConfidence(
  citations: KnowledgeQueryCitation[],
  plan: QueryBuilderPlan,
): number {
  if (citations.length === 0) return 0;
  const freshnessBoost = Math.max(
    0,
    100 -
      Math.min(
        ...citations
          .map((c) => c.sourceFreshnessHours ?? 168)
          .filter((v): v is number => typeof v === 'number'),
        168,
      ),
  );
  const coverage = Math.min(100, citations.length * 10);
  const warningsPenalty = plan.warnings.length * 5;
  return Math.max(
    0,
    Math.min(100, Math.round((freshnessBoost + coverage) / 2 - warningsPenalty)),
  );
}
