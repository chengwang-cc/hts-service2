import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import { OpenAiService } from '@hts/core';
import {
  FormulaSemanticsService,
  TariffEvidenceEntity,
  TariffKnowledgeCardEntity,
  validateFormulaArtifacts,
} from '@hts/calculator';
import { TariffSourceEntity } from '../../jurisdiction/entities/tariff-source.entity';
import { PolicyDocumentEntity } from '../entities/policy-document.entity';
import { PolicyChangeProposalEntity } from '../entities/policy-change-proposal.entity';

type JsonObject = Record<string, unknown>;
type PolicySourceKey =
  | 'federal_register'
  | 'usitc_archive'
  | 'ustr'
  | 'cbp_csms';

interface FetchedPolicyDocument {
  sourceName: string;
  externalId: string;
  title: string;
  documentUrl: string | null;
  snapshotUri: string | null;
  documentText: string | null;
  publishedAt: string | null;
  metadata: JsonObject;
}

export interface RunPolicyMonitorOptions {
  sources?: PolicySourceKey[];
  sinceDays?: number;
  limitPerSource?: number;
  aiExtraction?: boolean;
}

export interface RunPolicyMonitorResult {
  sourcesScanned: number;
  fetchedDocuments: number;
  recordedDocuments: number;
  proposalsRecorded: number;
}

export interface RecordPolicyDocumentInput {
  sourceId?: string | null;
  sourceName: string;
  externalId: string;
  title: string;
  documentUrl?: string | null;
  snapshotUri?: string | null;
  documentText?: string | null;
  publishedAt?: string | Date | null;
  metadata?: JsonObject | null;
}

export interface RecordPolicyProposalInput {
  documentId: string;
  htsNumber?: string | null;
  countryCode?: string;
  destinationCode?: string;
  rateClass: string;
  componentType?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  oldRateText?: string | null;
  newRateText?: string | null;
  proposedFormula?: string | null;
  proposedConditionAst?: JsonObject | null;
  citationQuote?: string | null;
  parserConfidence?: number | null;
  parserName?: string | null;
  parserVersion?: string | null;
  metadata?: JsonObject | null;
}

@Injectable()
export class PolicyChangeMonitorService {
  constructor(
    @InjectRepository(PolicyDocumentEntity)
    private readonly documentRepo: Repository<PolicyDocumentEntity>,
    @InjectRepository(PolicyChangeProposalEntity)
    private readonly proposalRepo: Repository<PolicyChangeProposalEntity>,
    @InjectRepository(TariffKnowledgeCardEntity)
    private readonly cardRepo: Repository<TariffKnowledgeCardEntity>,
    @InjectRepository(TariffEvidenceEntity)
    private readonly evidenceRepo: Repository<TariffEvidenceEntity>,
    @InjectRepository(TariffSourceEntity)
    private readonly sourceRepo: Repository<TariffSourceEntity>,
    private readonly formulaSemantics: FormulaSemanticsService,
    private readonly openAiService: OpenAiService,
  ) {}

  async runConfiguredMonitors(
    options: RunPolicyMonitorOptions = {},
  ): Promise<RunPolicyMonitorResult> {
    const sources = options.sources?.length
      ? options.sources
      : ([
          'federal_register',
          'usitc_archive',
          'ustr',
          'cbp_csms',
        ] as PolicySourceKey[]);
    const limitPerSource = Math.min(
      Math.max(options.limitPerSource ?? 10, 1),
      50,
    );
    let fetchedDocuments = 0;
    let recordedDocuments = 0;
    let proposalsRecorded = 0;

    for (const source of sources) {
      const documents = await this.fetchSourceDocuments(source, {
        sinceDays: options.sinceDays ?? 7,
        limit: limitPerSource,
      });
      fetchedDocuments += documents.length;

      for (const fetched of documents) {
        const document = await this.recordDocument({
          sourceName: fetched.sourceName,
          externalId: fetched.externalId,
          title: fetched.title,
          documentUrl: fetched.documentUrl,
          snapshotUri: fetched.snapshotUri,
          documentText: fetched.documentText,
          publishedAt: fetched.publishedAt,
          metadata: fetched.metadata,
        });
        recordedDocuments++;

        const proposals = await this.extractPolicyProposals(
          document,
          options.aiExtraction ??
            process.env.POLICY_CHANGE_MONITOR_AI_ENABLED === 'true',
        );
        for (const proposal of proposals) {
          await this.recordProposal(proposal);
          proposalsRecorded++;
        }
      }
    }

    return {
      sourcesScanned: sources.length,
      fetchedDocuments,
      recordedDocuments,
      proposalsRecorded,
    };
  }

  async recordDocument(
    input: RecordPolicyDocumentInput,
  ): Promise<PolicyDocumentEntity> {
    const contentHash = input.documentText
      ? createHash('sha256').update(input.documentText).digest('hex')
      : null;
    const documentQuery = this.documentRepo
      .createQueryBuilder('document')
      .where('document.externalId = :externalId', {
        externalId: input.externalId,
      });
    if (input.sourceId) {
      documentQuery.andWhere('document.sourceId = :sourceId', {
        sourceId: input.sourceId,
      });
    } else {
      documentQuery.andWhere('document.sourceId IS NULL');
    }
    const existing = await documentQuery.getOne();
    const publishedAt = input.publishedAt ? new Date(input.publishedAt) : null;

    if (existing) {
      return this.documentRepo.save({
        ...existing,
        sourceName: input.sourceName,
        title: input.title,
        documentUrl: input.documentUrl || null,
        snapshotUri: input.snapshotUri || null,
        documentText: input.documentText || null,
        contentHash,
        publishedAt,
        status: 'fetched',
        metadata: input.metadata || null,
        fetchedAt: new Date(),
      });
    }

    return this.documentRepo.save(
      this.documentRepo.create({
        sourceId: input.sourceId || null,
        sourceName: input.sourceName,
        externalId: input.externalId,
        title: input.title,
        documentUrl: input.documentUrl || null,
        snapshotUri: input.snapshotUri || null,
        documentText: input.documentText || null,
        contentHash,
        publishedAt,
        fetchedAt: new Date(),
        status: 'fetched',
        metadata: input.metadata || null,
      }),
    );
  }

  async recordProposal(
    input: RecordPolicyProposalInput,
  ): Promise<PolicyChangeProposalEntity> {
    const conflict = await this.proposalConflictsWithCurrentCard(input);
    const proposal = await this.proposalRepo.save(
      this.proposalRepo.create({
        documentId: input.documentId,
        htsNumber: input.htsNumber || null,
        countryCode: (input.countryCode || 'ALL').toUpperCase(),
        destinationCode: (input.destinationCode || 'US').toUpperCase(),
        rateClass: input.rateClass,
        componentType: input.componentType || null,
        effectiveFrom: input.effectiveFrom || null,
        effectiveTo: input.effectiveTo || null,
        oldRateText: input.oldRateText || null,
        newRateText: input.newRateText || null,
        proposedFormula: input.proposedFormula || null,
        proposedConditionAst: input.proposedConditionAst || null,
        citationQuote: input.citationQuote || null,
        parserConfidence: input.parserConfidence ?? null,
        parserName: input.parserName || null,
        parserVersion: input.parserVersion || null,
        status: 'pending',
        evidenceId: null,
        reviewerNote: conflict
          ? 'Potential conflict with current knowledge card consensus.'
          : null,
        reviewedBy: null,
        reviewedAt: null,
        metadata: {
          ...(input.metadata || {}),
          conflictWithCurrentCard: conflict,
          reviewerAlert: conflict,
        },
      }),
    );
    const evidence = await this.createPendingEvidenceForProposal(
      input,
      proposal,
    );
    if (!evidence) {
      return proposal;
    }
    return this.proposalRepo.save({
      ...proposal,
      evidenceId: evidence.id,
      metadata: {
        ...(proposal.metadata || {}),
        evidenceId: evidence.id,
      },
    });
  }

  async pendingProposalCount(): Promise<number> {
    return this.proposalRepo.count({ where: { status: 'pending' } });
  }

  private async fetchSourceDocuments(
    source: PolicySourceKey,
    options: { sinceDays: number; limit: number },
  ): Promise<FetchedPolicyDocument[]> {
    switch (source) {
      case 'federal_register':
        return this.fetchFederalRegisterDocuments(options);
      case 'usitc_archive':
        return this.fetchUsitcArchiveDocuments(options);
      case 'ustr':
        return this.fetchSimpleHtmlDocuments({
          sourceName: 'USTR',
          sourceUrl:
            process.env.POLICY_MONITOR_USTR_URL ||
            'https://ustr.gov/about-us/policy-offices/press-office/press-releases',
          terms: ['tariff', 'section 301', 'section 232', 'hts', 'duties'],
          limit: options.limit,
        });
      case 'cbp_csms':
        return this.fetchSimpleHtmlDocuments({
          sourceName: 'CBP CSMS',
          sourceUrl:
            process.env.POLICY_MONITOR_CBP_CSMS_URL ||
            'https://www.cbp.gov/trade/automated/cargo-systems-messaging-service',
          terms: ['tariff', 'duty', 'duties', 'hts', 'hsu', 'section 301'],
          limit: options.limit,
        });
    }
  }

  private async fetchFederalRegisterDocuments(options: {
    sinceDays: number;
    limit: number;
  }): Promise<FetchedPolicyDocument[]> {
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - options.sinceDays);
    const url = new URL(
      'https://www.federalregister.gov/api/v1/documents.json',
    );
    url.searchParams.set('conditions[term]', 'tariff HTS duty USTR USITC CBP');
    url.searchParams.set(
      'conditions[publication_date][gte]',
      startDate.toISOString().slice(0, 10),
    );
    url.searchParams.set('order', 'newest');
    url.searchParams.set('per_page', String(options.limit));

    const json = await this.fetchJson<{
      results?: Array<Record<string, unknown>>;
    }>(url.toString());
    return (json.results || []).map((item) => {
      const documentNumber =
        this.asString(item.document_number) || this.hashObject(item);
      const title = this.asString(item.title) || documentNumber;
      return {
        sourceName: 'Federal Register',
        externalId: documentNumber,
        title,
        documentUrl: this.asString(item.html_url),
        snapshotUri: this.asString(item.json_url) || url.toString(),
        documentText: [
          title,
          this.asString(item.abstract),
          this.asString(item.excerpts),
          this.asString(item.full_text_xml_url),
        ]
          .filter(Boolean)
          .join('\n\n'),
        publishedAt: this.asString(item.publication_date),
        metadata: {
          source: 'federal_register_api',
          raw: item,
        },
      };
    });
  }

  private async fetchUsitcArchiveDocuments(options: {
    limit: number;
  }): Promise<FetchedPolicyDocument[]> {
    const sourceUrl =
      process.env.POLICY_MONITOR_USITC_ARCHIVE_URL ||
      'https://www.usitc.gov/harmonized_tariff_information/hts/archive/list';
    const html = await this.fetchText(sourceUrl);
    const text = this.compactWhitespace(cheerio.load(html).text());
    const matches = Array.from(
      text.matchAll(
        /(20\d{2}\s+HTS[A]?\s+(?:Revision\s+\d+|Basic Edition)[^]*?)(?=20\d{2}\s+HTS[A]?\s+(?:Revision\s+\d+|Basic Edition)|CONTACT US|$)/gi,
      ),
    ).slice(0, options.limit);

    return matches.map((match) => {
      const body = this.compactWhitespace(match[1]).slice(0, 8000);
      const title =
        body
          .match(
            /20\d{2}\s+HTS[A]?\s+(?:Revision\s+\d+|Basic Edition)[^(]*/i,
          )?.[0]
          ?.trim() || 'USITC HTS archive revision';
      return {
        sourceName: 'USITC HTS Archive',
        externalId: this.normalizeExternalId(title),
        title,
        documentUrl: sourceUrl,
        snapshotUri: sourceUrl,
        documentText: body,
        publishedAt: this.extractDateString(body),
        metadata: {
          source: 'usitc_archive_page',
        },
      };
    });
  }

  private async fetchSimpleHtmlDocuments(args: {
    sourceName: string;
    sourceUrl: string;
    terms: string[];
    limit: number;
  }): Promise<FetchedPolicyDocument[]> {
    const html = await this.fetchText(args.sourceUrl);
    const $ = cheerio.load(html);
    const documents: FetchedPolicyDocument[] = [];
    const seen = new Set<string>();

    $('a').each((_, anchor) => {
      if (documents.length >= args.limit) {
        return false;
      }
      const title = this.compactWhitespace($(anchor).text());
      const href = $(anchor).attr('href');
      if (!title || !href) {
        return;
      }
      const haystack = title.toLowerCase();
      if (!args.terms.some((term) => haystack.includes(term))) {
        return;
      }
      const documentUrl = new URL(href, args.sourceUrl).toString();
      const externalId = this.normalizeExternalId(
        `${args.sourceName}:${documentUrl}`,
      );
      if (seen.has(externalId)) {
        return;
      }
      seen.add(externalId);
      documents.push({
        sourceName: args.sourceName,
        externalId,
        title,
        documentUrl,
        snapshotUri: documentUrl,
        documentText: title,
        publishedAt: null,
        metadata: {
          source: 'html_link_monitor',
          pageUrl: args.sourceUrl,
        },
      });
    });

    if (documents.length === 0) {
      const title = `${args.sourceName} source page snapshot`;
      documents.push({
        sourceName: args.sourceName,
        externalId: this.normalizeExternalId(
          `${args.sourceName}:${this.hashText(html)}`,
        ),
        title,
        documentUrl: args.sourceUrl,
        snapshotUri: args.sourceUrl,
        documentText: this.compactWhitespace($.text()).slice(0, 12000),
        publishedAt: null,
        metadata: {
          source: 'html_page_monitor',
        },
      });
    }

    return documents;
  }

  private async extractPolicyProposals(
    document: PolicyDocumentEntity,
    aiExtraction: boolean,
  ): Promise<RecordPolicyProposalInput[]> {
    if (aiExtraction) {
      const ai = await this.extractPolicyProposalsWithAi(document);
      if (ai.length > 0) {
        return ai;
      }
    }
    return this.extractPolicyProposalsDeterministically(document);
  }

  private extractPolicyProposalsDeterministically(
    document: PolicyDocumentEntity,
  ): RecordPolicyProposalInput[] {
    const text = `${document.title}\n${document.documentText || ''}`;
    const htsNumbers = Array.from(
      new Set(
        Array.from(
          text.matchAll(/\b\d{4}\.\d{2}(?:\.\d{2})?(?:\.\d{2})?\b/g),
        ).map((match) => match[0]),
      ),
    );
    const countries = this.extractCountries(text);
    const rates = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*%/g))
      .map((match) => Number(match[1]))
      .filter((rate) => Number.isFinite(rate) && rate > 0 && rate < 1000);
    if (htsNumbers.length === 0 && rates.length === 0) {
      return [];
    }
    const rateClass = this.inferRateClass(text);
    const componentType = this.inferComponentType(rateClass);
    const rate = rates[0] ?? null;
    const proposedFormula = rate === null ? null : `value * ${rate / 100}`;
    const scopes = htsNumbers.length > 0 ? htsNumbers : [null];
    const countryScopes = countries.length > 0 ? countries : ['ALL'];
    const proposals: RecordPolicyProposalInput[] = [];

    for (const htsNumber of scopes.slice(0, 25)) {
      for (const countryCode of countryScopes.slice(0, 10)) {
        proposals.push({
          documentId: document.id,
          htsNumber,
          countryCode,
          destinationCode: 'US',
          rateClass,
          componentType,
          effectiveFrom: this.extractDateString(text),
          effectiveTo: null,
          oldRateText: null,
          newRateText: rate === null ? null : `${rate}%`,
          proposedFormula,
          proposedConditionAst:
            countryCode === 'ALL'
              ? { kind: 'always' }
              : { kind: 'country_in', countries: [countryCode] },
          citationQuote: this.extractCitationQuote(text, rate),
          parserConfidence: proposedFormula ? 0.65 : 0.35,
          parserName: 'policy-change-monitor-deterministic',
          parserVersion: 'phase-4-source-adapter-v1',
          metadata: {
            extractionMethod: 'deterministic_regex',
            sourceDocumentId: document.id,
          },
        });
      }
    }

    return proposals;
  }

  private async extractPolicyProposalsWithAi(
    document: PolicyDocumentEntity,
  ): Promise<RecordPolicyProposalInput[]> {
    const text = `${document.title}\n${document.documentText || ''}`.slice(
      0,
      16000,
    );
    try {
      const response = await this.openAiService.response(text, {
        model: process.env.POLICY_CHANGE_MONITOR_AI_MODEL || 'gpt-5.4-mini',
        instructions:
          'Extract tariff policy changes as JSON. Return pending evidence proposals only. Never mark anything accepted. Include exact citation_quote text.',
        max_output_tokens: 2500,
        text: {
          format: {
            type: 'json_schema',
            name: 'tariff_policy_proposals',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                proposals: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      htsNumber: { type: ['string', 'null'] },
                      countryCode: { type: 'string' },
                      rateClass: { type: 'string' },
                      componentType: { type: ['string', 'null'] },
                      effectiveFrom: { type: ['string', 'null'] },
                      effectiveTo: { type: ['string', 'null'] },
                      newRateText: { type: ['string', 'null'] },
                      proposedFormula: { type: ['string', 'null'] },
                      citationQuote: { type: ['string', 'null'] },
                      confidence: { type: ['number', 'null'] },
                    },
                    required: [
                      'htsNumber',
                      'countryCode',
                      'rateClass',
                      'componentType',
                      'effectiveFrom',
                      'effectiveTo',
                      'newRateText',
                      'proposedFormula',
                      'citationQuote',
                      'confidence',
                    ],
                  },
                },
              },
              required: ['proposals'],
            },
            strict: true,
          },
        },
      });
      const parsed = JSON.parse((response as any).output_text || '{}') as {
        proposals?: Array<Record<string, unknown>>;
      };
      return (parsed.proposals || []).slice(0, 50).map((proposal) => ({
        documentId: document.id,
        htsNumber: this.asString(proposal.htsNumber),
        countryCode: this.asString(proposal.countryCode) || 'ALL',
        destinationCode: 'US',
        rateClass: this.asString(proposal.rateClass) || 'additional_duty',
        componentType: this.asString(proposal.componentType),
        effectiveFrom: this.asString(proposal.effectiveFrom),
        effectiveTo: this.asString(proposal.effectiveTo),
        oldRateText: null,
        newRateText: this.asString(proposal.newRateText),
        proposedFormula: this.asString(proposal.proposedFormula),
        proposedConditionAst: { kind: 'pending_ai_review' },
        citationQuote: this.asString(proposal.citationQuote),
        parserConfidence: this.asNumber(proposal.confidence),
        parserName: 'policy-change-monitor-ai',
        parserVersion: 'phase-4-ai-v1',
        metadata: {
          extractionMethod: 'ai',
          aiModel: response.model,
          sourceDocumentId: document.id,
        },
      }));
    } catch {
      return [];
    }
  }

  private async proposalConflictsWithCurrentCard(
    input: RecordPolicyProposalInput,
  ): Promise<boolean> {
    if (!input.proposedFormula || !input.htsNumber) {
      return false;
    }
    const card = await this.cardRepo
      .createQueryBuilder('card')
      .where('card.htsNumber = :htsNumber', { htsNumber: input.htsNumber })
      .andWhere('card.countryCode IN (:...countryCodes)', {
        countryCodes: [(input.countryCode || 'ALL').toUpperCase(), 'ALL'],
      })
      .andWhere('card.destinationCode = :destinationCode', {
        destinationCode: (input.destinationCode || 'US').toUpperCase(),
      })
      .andWhere('card.rateClass = :rateClass', {
        rateClass: input.rateClass,
      })
      .andWhere('card.status IN (:...statuses)', {
        statuses: ['authoritative', 'provisional', 'disputed'],
      })
      .orderBy('card.effectiveFrom', 'DESC')
      .limit(1)
      .getOne();
    if (!card?.consensusFormula) {
      return false;
    }
    const proposed = this.formulaSemantics.analyze(input.proposedFormula);
    const current = this.formulaSemantics.analyze(card.consensusFormula);
    return proposed.semanticHash !== current.semanticHash;
  }

  private async createPendingEvidenceForProposal(
    input: RecordPolicyProposalInput,
    proposal: PolicyChangeProposalEntity,
  ): Promise<TariffEvidenceEntity | null> {
    if (!input.htsNumber || !input.proposedFormula) {
      return null;
    }
    const document = await this.documentRepo.findOne({
      where: { id: input.documentId },
    });
    const source = await this.resolveSourceForDocument(document);
    const semantic = this.formulaSemantics.analyze(input.proposedFormula);
    const conditionAst = input.proposedConditionAst || {
      kind: 'pending_policy_review',
    };
    const unitDimensions = {};
    const constraints = {};
    const roundingPolicy = { mode: 'component_2dp' };
    const artifactValidation = validateFormulaArtifacts(
      {
        formulaText: input.proposedFormula,
        formulaAst: semantic.formulaAst,
        conditionAst,
        unitDimensions,
        constraints,
        roundingPolicy,
      },
      { requireRuntimeArtifacts: true },
    );
    const validationErrors = [
      ...semantic.validationErrors,
      ...artifactValidation.errors,
    ];
    const validationStatus =
      validationErrors.length === 0 ? 'valid' : 'needs_review';
    const snapshotUri =
      document?.snapshotUri ||
      document?.documentUrl ||
      `internal://policy-change-proposal/${proposal.id}`;

    const existing = await this.evidenceRepo
      .createQueryBuilder('evidence')
      .where('evidence.htsNumber = :htsNumber', { htsNumber: input.htsNumber })
      .andWhere('evidence.countryCode = :countryCode', {
        countryCode: (input.countryCode || 'ALL').toUpperCase(),
      })
      .andWhere('evidence.destinationCode = :destinationCode', {
        destinationCode: (input.destinationCode || 'US').toUpperCase(),
      })
      .andWhere('evidence.rateClass = :rateClass', {
        rateClass: input.rateClass,
      })
      .andWhere('evidence.componentType = :componentType', {
        componentType:
          input.componentType || this.inferComponentType(input.rateClass),
      })
      .andWhere('evidence.citationSnapshotUri = :snapshotUri', { snapshotUri })
      .andWhere('evidence.formulaSemanticHash = :semanticHash', {
        semanticHash: semantic.semanticHash,
      })
      .getOne();
    if (existing) {
      return existing;
    }

    return this.evidenceRepo.save(
      this.evidenceRepo.create({
        htsNumber: input.htsNumber,
        countryCode: (input.countryCode || 'ALL').toUpperCase(),
        destinationCode: (input.destinationCode || 'US').toUpperCase(),
        rateClass: input.rateClass,
        componentType:
          input.componentType || this.inferComponentType(input.rateClass),
        calculationStage: this.calculationStageForRateClass(input.rateClass),
        sourceId: source?.id || null,
        citationUrl: document?.documentUrl || source?.sourceUrl || null,
        citationQuote:
          input.citationQuote || input.newRateText || document?.title || null,
        citationSnapshotUri: snapshotUri,
        sourceEffectiveFrom: input.effectiveFrom || null,
        sourceEffectiveTo: input.effectiveTo || null,
        retrievedAt: new Date(),
        rateText: input.newRateText || null,
        formulaText: input.proposedFormula,
        formulaAst: semantic.formulaAst,
        formulaCanonical: semantic.canonicalFormula,
        compiledFormula: input.proposedFormula,
        formulaSemanticHash: semantic.semanticHash,
        conditionAst,
        unitDimensions,
        constraints,
        roundingPolicy,
        parserName: input.parserName || 'policy-change-monitor',
        parserVersion: input.parserVersion || 'phase-4-policy-evidence-v1',
        parserConfidence: input.parserConfidence ?? null,
        aiModel:
          input.metadata?.extractionMethod === 'ai'
            ? String(input.metadata?.aiModel || '') || null
            : null,
        aiPromptVersion:
          input.metadata?.extractionMethod === 'ai' ? 'phase-4-ai-v1' : null,
        validationStatus,
        validationErrors: validationErrors.length > 0 ? validationErrors : null,
        testVectors: null,
        reviewerConfidence: null,
        reviewer: null,
        reviewedAt: null,
        status: 'pending',
        supersededBy: null,
        metadata: {
          source: 'policy-change-monitor',
          proposalId: proposal.id,
          documentId: input.documentId,
          conflictWithCurrentCard:
            proposal.metadata?.conflictWithCurrentCard || false,
          artifactValidatorVersion: artifactValidation.validatorVersion,
          artifactValidationErrors: artifactValidation.errors,
        },
      }),
    );
  }

  private async resolveSourceForDocument(
    document: PolicyDocumentEntity | null,
  ): Promise<TariffSourceEntity | null> {
    const sourceName = this.sourceNameForDocument(document?.sourceName || '');
    return this.sourceRepo.findOne({
      where: {
        jurisdictionCode: 'US',
        sourceName,
      },
    });
  }

  private sourceNameForDocument(sourceName: string): string {
    const normalized = sourceName.toLowerCase();
    if (normalized.includes('federal register')) return 'Federal Register API';
    if (normalized.includes('ustr')) return 'USTR Section 301';
    if (normalized.includes('csms') || normalized.includes('cbp')) {
      return 'CBP CSMS Bulletins';
    }
    if (normalized.includes('usitc')) return 'USITC HTS JSON';
    return 'Federal Register API';
  }

  private calculationStageForRateClass(rateClass: string): string {
    const normalized = rateClass.toLowerCase();
    if (normalized === 'mpf' || normalized === 'hmf')
      return 'post_calculation_fee';
    if (normalized === 'post_tax') return 'tax';
    if (normalized === 'base' || normalized === 'general') return 'base';
    return 'additional_duty';
  }

  private extractCountries(text: string): string[] {
    const countries = new Set<string>();
    const map: Array<[RegExp, string]> = [
      [/\b(china|people'?s republic of china|prc)\b/i, 'CN'],
      [/\bcanada\b/i, 'CA'],
      [/\bmexico\b/i, 'MX'],
      [/\bkorea\b/i, 'KR'],
      [/\bgermany\b/i, 'DE'],
      [/\bunited kingdom|great britain|\buk\b/i, 'GB'],
      [/\beuropean union|\beu\b/i, 'EU'],
    ];
    for (const [pattern, code] of map) {
      if (pattern.test(text)) {
        countries.add(code);
      }
    }
    return Array.from(countries);
  }

  private inferRateClass(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes('section 301')) return 'section_301';
    if (
      lower.includes('section 232') ||
      lower.includes('steel') ||
      lower.includes('aluminum')
    ) {
      return 'section_232';
    }
    if (lower.includes('section 122')) return 'section_122';
    if (lower.includes('reciprocal')) return 'chapter_99';
    return 'additional_duty';
  }

  private inferComponentType(rateClass: string): string {
    return rateClass === 'additional_duty' ? 'chapter_99' : rateClass;
  }

  private extractCitationQuote(
    text: string,
    rate: number | null,
  ): string | null {
    if (rate === null) {
      return text.slice(0, 500);
    }
    const index = text.indexOf(`${rate}%`);
    if (index < 0) {
      return text.slice(0, 500);
    }
    return text.slice(Math.max(0, index - 220), index + 280);
  }

  private extractDateString(text: string): string | null {
    const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) return iso[0];
    const slash = text.match(/\b(20\d{2})\/(\d{1,2})\/(\d{1,2})\b/);
    if (slash) {
      return `${slash[1]}-${slash[2].padStart(2, '0')}-${slash[3].padStart(2, '0')}`;
    }
    return null;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'hts-service-policy-monitor/1.0',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }
    return response.json() as Promise<T>;
  }

  private async fetchText(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xml,text/plain,*/*',
        'user-agent': 'hts-service-policy-monitor/1.0',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }
    return response.text();
  }

  private normalizeExternalId(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private hashText(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private hashObject(value: unknown): string {
    return this.hashText(JSON.stringify(value));
  }

  private compactWhitespace(value: string): string {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  private asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}
