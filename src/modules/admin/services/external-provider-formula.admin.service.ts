import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import {
  ExternalProviderFormulaEntity,
  HtsEntity,
  HtsFormulaUpdateService,
  OpenAiService,
} from '@hts/core';
import {
  AnalyzeExternalProviderDiscrepancyDto,
  CompareExternalProviderFormulaDto,
  ListExternalProviderFormulasDto,
  ManualReviewExternalProviderFormulaDto,
  PublishExternalProviderFormulaDto,
  ReviewExternalProviderFormulaDto,
  UpsertExternalProviderFormulaDto,
  ValidateExternalProviderFormulaDto,
} from '../dto/external-provider-formula.dto';

type UpsertAction = 'CREATED' | 'REFRESHED' | 'VERSIONED';

type LiveFormulaProjection = {
  id: string;
  htsNumber: string;
  rateFormula: string | null;
  adjustedFormula: string | null;
  otherRateFormula: string | null;
  chapter99ApplicableCountries: string[] | null;
  nonNtrApplicableCountries: string[] | null;
  selectedFormulaType: 'GENERAL' | 'CHAPTER99' | 'NON_NTR' | 'SPECIAL';
  selectedFormula: string | null;
  selectedRateText: string | null;
  selectedSpecialRate: string | null;
} | null;

type LiveComparisonResult = {
  providerSnapshot: ExternalProviderFormulaEntity | null;
  liveHts: LiveFormulaProjection;
  comparison: {
    isMatch: boolean;
    providerNormalized: string | null;
    liveNormalized: string | null;
    mismatchReason:
      | 'NO_PROVIDER_SNAPSHOT'
      | 'NO_PROVIDER_FORMULA'
      | 'NO_LIVE_FORMULA'
      | 'FORMULA_MISMATCH'
      | 'MATCH';
  };
};

type ProviderFetchResult = {
  provider: string;
  htsNumber: string;
  countryCode: string;
  entryDate: string;
  modeOfTransport: string;
  inputContext: Record<string, any>;
  formulaRaw: string | null;
  formulaNormalized: string | null;
  formulaComponents: Record<string, any> | null;
  outputBreakdown: Record<string, any> | null;
  extractionMethod: 'API' | 'NETWORK' | 'DOM' | 'MANUAL' | 'AI';
  extractionConfidence: number;
  parserVersion: string;
  sourceUrl: string;
  evidence: Record<string, any> | null;
};

@Injectable()
export class ExternalProviderFormulaAdminService {
  private readonly logger = new Logger(
    ExternalProviderFormulaAdminService.name,
  );

  constructor(
    @InjectRepository(ExternalProviderFormulaEntity)
    private readonly externalFormulaRepo: Repository<ExternalProviderFormulaEntity>,
    @InjectRepository(HtsEntity)
    private readonly htsRepo: Repository<HtsEntity>,
    private readonly formulaUpdateService: HtsFormulaUpdateService,
  ) {}

  async upsertSnapshot(
    dto: UpsertExternalProviderFormulaDto,
    observedBy?: string,
  ): Promise<{
    action: UpsertAction;
    contextHash: string;
    data: ExternalProviderFormulaEntity;
    previousId?: string;
  }> {
    const normalizedProvider = (dto.provider || '').trim().toUpperCase();
    const normalizedCountry = (dto.countryCode || '').trim().toUpperCase();
    const normalizedMode = (dto.modeOfTransport || 'OCEAN')
      .trim()
      .toUpperCase();
    const normalizedInputContext = this.normalizeJson(dto.inputContext || {});
    const contextHash = this.hashContext(
      normalizedProvider,
      normalizedInputContext,
    );
    const observedAt = dto.observedAt ? new Date(dto.observedAt) : new Date();

    const basePayload = {
      provider: normalizedProvider,
      htsNumber: (dto.htsNumber || '').trim(),
      countryCode: normalizedCountry,
      entryDate: dto.entryDate,
      modeOfTransport: normalizedMode,
      inputContext: normalizedInputContext,
      contextHash,
      formulaRaw: dto.formulaRaw || null,
      formulaNormalized: dto.formulaNormalized || null,
      formulaComponents: dto.formulaComponents || null,
      outputBreakdown: dto.outputBreakdown || null,
      extractionMethod: (dto.extractionMethod || 'NETWORK').toUpperCase(),
      extractionConfidence: dto.extractionConfidence ?? 0,
      parserVersion: dto.parserVersion || 'v1',
      sourceUrl: dto.sourceUrl,
      evidence: dto.evidence || null,
      observedAt,
      observedBy: observedBy || null,
      reviewStatus: 'PENDING',
      reviewDecisionComment: null,
      reviewedBy: null,
      reviewedAt: null,
      publishedFormulaUpdateId: null,
      publishedBy: null,
      publishedAt: null,
      publishMetadata: null,
    };

    if (dto.upsertLatest === false) {
      const historical = this.externalFormulaRepo.create({
        ...basePayload,
        isLatest: false,
        supersededAt: null,
      });
      const saved = await this.externalFormulaRepo.save(historical);
      return {
        action: 'CREATED',
        contextHash,
        data: saved,
      };
    }

    const latest = await this.externalFormulaRepo.findOne({
      where: {
        provider: normalizedProvider,
        contextHash,
        isLatest: true,
      },
      order: {
        observedAt: 'DESC',
      },
    });

    if (!latest) {
      const created = this.externalFormulaRepo.create({
        ...basePayload,
        isLatest: true,
        supersededAt: null,
      });
      const saved = await this.externalFormulaRepo.save(created);
      return {
        action: 'CREATED',
        contextHash,
        data: saved,
      };
    }

    const hasChanged = this.hasSnapshotChanged(latest, basePayload);
    if (!hasChanged) {
      latest.observedAt = observedAt;
      latest.observedBy = observedBy || latest.observedBy;
      latest.evidence = dto.evidence || latest.evidence;
      latest.outputBreakdown = dto.outputBreakdown || latest.outputBreakdown;
      latest.extractionConfidence =
        dto.extractionConfidence ?? latest.extractionConfidence;
      const refreshed = await this.externalFormulaRepo.save(latest);

      return {
        action: 'REFRESHED',
        contextHash,
        data: refreshed,
      };
    }

    latest.isLatest = false;
    latest.supersededAt = new Date();
    await this.externalFormulaRepo.save(latest);

    const versioned = this.externalFormulaRepo.create({
      ...basePayload,
      isLatest: true,
      supersededAt: null,
    });
    const saved = await this.externalFormulaRepo.save(versioned);

    return {
      action: 'VERSIONED',
      contextHash,
      data: saved,
      previousId: latest.id,
    };
  }

  async findAll(dto: ListExternalProviderFormulasDto): Promise<{
    data: ExternalProviderFormulaEntity[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const query = this.externalFormulaRepo.createQueryBuilder('formula');

    if (dto.provider) {
      query.andWhere('formula.provider = :provider', {
        provider: dto.provider.trim().toUpperCase(),
      });
    }

    if (dto.htsNumber) {
      query.andWhere('formula.htsNumber = :htsNumber', {
        htsNumber: dto.htsNumber.trim(),
      });
    }

    if (dto.countryCode) {
      query.andWhere('formula.countryCode = :countryCode', {
        countryCode: dto.countryCode.trim().toUpperCase(),
      });
    }

    if (dto.modeOfTransport) {
      query.andWhere('formula.modeOfTransport = :modeOfTransport', {
        modeOfTransport: dto.modeOfTransport.trim().toUpperCase(),
      });
    }

    if (dto.entryDate) {
      query.andWhere('formula.entryDate = :entryDate', {
        entryDate: dto.entryDate,
      });
    }

    if (typeof dto.isLatest === 'boolean') {
      query.andWhere('formula.isLatest = :isLatest', {
        isLatest: dto.isLatest,
      });
    }

    if (dto.reviewStatus) {
      query.andWhere('formula.reviewStatus = :reviewStatus', {
        reviewStatus: dto.reviewStatus.trim().toUpperCase(),
      });
    }

    query
      .orderBy('formula.observedAt', 'DESC')
      .addOrderBy('formula.createdAt', 'DESC');

    const [data, total] = await query
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { data, total, page, pageSize };
  }

  async findOne(id: string): Promise<ExternalProviderFormulaEntity> {
    const record = await this.externalFormulaRepo.findOne({
      where: { id },
    });

    if (!record) {
      throw new NotFoundException(
        `External provider formula snapshot not found: ${id}`,
      );
    }

    return record;
  }

  async compareWithLiveFormula(
    dto: CompareExternalProviderFormulaDto,
  ): Promise<LiveComparisonResult> {
    const normalizedProvider = (dto.provider || '').trim().toUpperCase();
    const normalizedCountry = (dto.countryCode || '').trim().toUpperCase();
    const normalizedMode = (dto.modeOfTransport || 'OCEAN')
      .trim()
      .toUpperCase();

    const providerSnapshot = await this.externalFormulaRepo.findOne({
      where: {
        provider: normalizedProvider,
        htsNumber: (dto.htsNumber || '').trim(),
        countryCode: normalizedCountry,
        entryDate: dto.entryDate,
        modeOfTransport: normalizedMode,
        isLatest: true,
      },
      order: {
        observedAt: 'DESC',
      },
    });

    const liveHtsEntity = await this.htsRepo.findOne({
      where: {
        htsNumber: (dto.htsNumber || '').trim(),
        isActive: true,
      },
      order: {
        importDate: 'DESC',
        updatedAt: 'DESC',
      },
    });

    const liveProjection = this.projectLiveFormula(
      liveHtsEntity,
      normalizedCountry,
    );
    const providerFormulaNormalized = providerSnapshot
      ? this.normalizeFormula(
          providerSnapshot.formulaNormalized ||
            providerSnapshot.formulaRaw ||
            null,
        )
      : null;
    const liveFormulaNormalized = this.normalizeFormula(
      liveProjection?.selectedFormula || null,
    );

    if (!providerSnapshot) {
      return {
        providerSnapshot: null,
        liveHts: liveProjection,
        comparison: {
          isMatch: false,
          providerNormalized: null,
          liveNormalized: liveFormulaNormalized,
          mismatchReason: 'NO_PROVIDER_SNAPSHOT',
        },
      };
    }

    if (!providerFormulaNormalized) {
      return {
        providerSnapshot,
        liveHts: liveProjection,
        comparison: {
          isMatch: false,
          providerNormalized: null,
          liveNormalized: liveFormulaNormalized,
          mismatchReason: 'NO_PROVIDER_FORMULA',
        },
      };
    }

    if (!liveFormulaNormalized) {
      return {
        providerSnapshot,
        liveHts: liveProjection,
        comparison: {
          isMatch: false,
          providerNormalized: providerFormulaNormalized,
          liveNormalized: null,
          mismatchReason: 'NO_LIVE_FORMULA',
        },
      };
    }

    const isMatch = providerFormulaNormalized === liveFormulaNormalized;
    return {
      providerSnapshot,
      liveHts: liveProjection,
      comparison: {
        isMatch,
        providerNormalized: providerFormulaNormalized,
        liveNormalized: liveFormulaNormalized,
        mismatchReason: isMatch ? 'MATCH' : 'FORMULA_MISMATCH',
      },
    };
  }

  async validateAgainstProvider(
    dto: ValidateExternalProviderFormulaDto,
    observedBy?: string,
  ): Promise<{
    snapshotAction: UpsertAction;
    contextHash: string;
    previousId?: string;
    snapshot: ExternalProviderFormulaEntity;
    comparison: LiveComparisonResult;
    providerFetch: {
      provider: string;
      sourceUrl: string;
      extractionMethod: string;
      extractionConfidence: number;
      formulaExtracted: boolean;
      usedMock: boolean;
    };
    analysis: {
      summary: string;
      probableCauses: string[];
      recommendedActions: string[];
      confidence: number;
      provider: 'ai' | 'rules';
    } | null;
  }> {
    const provider = (dto.provider || '').trim().toUpperCase();
    if (!provider) {
      throw new BadRequestException('provider is required');
    }

    const fetchResult = await this.fetchProviderSnapshot(dto);
    const usedMock =
      dto.useMock === true ||
      process.env.EXTERNAL_PROVIDER_FLEXPORT_MOCK === 'true';
    const providerFormulaExtracted = !!(
      fetchResult.formulaNormalized || fetchResult.formulaRaw
    );
    const requireFormulaExtraction = dto.requireFormulaExtraction !== false;
    if (requireFormulaExtraction && !providerFormulaExtracted) {
      throw new BadRequestException(
        this.buildProviderExtractionFailureMessage(fetchResult),
      );
    }

    const upsertResult = await this.upsertSnapshot(
      {
        provider: fetchResult.provider,
        htsNumber: fetchResult.htsNumber,
        countryCode: fetchResult.countryCode,
        entryDate: fetchResult.entryDate,
        modeOfTransport: fetchResult.modeOfTransport,
        inputContext: fetchResult.inputContext,
        formulaRaw: fetchResult.formulaRaw || undefined,
        formulaNormalized: fetchResult.formulaNormalized || undefined,
        formulaComponents: fetchResult.formulaComponents || undefined,
        outputBreakdown: fetchResult.outputBreakdown || undefined,
        extractionMethod: fetchResult.extractionMethod,
        extractionConfidence: fetchResult.extractionConfidence,
        parserVersion: fetchResult.parserVersion,
        sourceUrl: fetchResult.sourceUrl,
        evidence: fetchResult.evidence || undefined,
        upsertLatest: dto.upsertLatest ?? true,
      },
      observedBy,
    );

    const comparison = await this.compareWithLiveFormula({
      provider: fetchResult.provider,
      htsNumber: fetchResult.htsNumber,
      countryCode: fetchResult.countryCode,
      entryDate: fetchResult.entryDate,
      modeOfTransport: fetchResult.modeOfTransport,
    });

    let analysis: {
      summary: string;
      probableCauses: string[];
      recommendedActions: string[];
      confidence: number;
      provider: 'ai' | 'rules';
    } | null = null;

    if ((dto.autoAnalyzeOnMismatch ?? true) && !comparison.comparison.isMatch) {
      const analysisResult = await this.analyzeDiscrepancy({
        provider: fetchResult.provider,
        htsNumber: fetchResult.htsNumber,
        countryCode: fetchResult.countryCode,
        entryDate: fetchResult.entryDate,
        modeOfTransport: fetchResult.modeOfTransport,
      });
      analysis = analysisResult.analysis;
    }

    return {
      snapshotAction: upsertResult.action,
      contextHash: upsertResult.contextHash,
      previousId: upsertResult.previousId,
      snapshot: upsertResult.data,
      comparison,
      providerFetch: {
        provider: fetchResult.provider,
        sourceUrl: fetchResult.sourceUrl,
        extractionMethod: fetchResult.extractionMethod,
        extractionConfidence: fetchResult.extractionConfidence,
        formulaExtracted: providerFormulaExtracted,
        usedMock,
      },
      analysis,
    };
  }

  async manualReviewSnapshot(
    dto: ManualReviewExternalProviderFormulaDto,
    observedBy?: string,
  ): Promise<{
    snapshotAction: UpsertAction;
    contextHash: string;
    previousId?: string;
    snapshot: ExternalProviderFormulaEntity;
    comparison: LiveComparisonResult;
    analysis: {
      summary: string;
      probableCauses: string[];
      recommendedActions: string[];
      confidence: number;
      provider: 'ai' | 'rules';
    } | null;
  }> {
    const manualFormulaRaw = (dto.manualFormulaRaw || '').trim();
    if (!manualFormulaRaw) {
      throw new BadRequestException('manualFormulaRaw is required');
    }

    const normalizedManualFormula =
      this.normalizeFormula(dto.manualFormulaNormalized || null) ||
      this.normalizeFormula(manualFormulaRaw);

    const upsertResult = await this.upsertSnapshot(
      {
        provider: dto.provider,
        htsNumber: dto.htsNumber,
        countryCode: dto.countryCode,
        entryDate: dto.entryDate,
        modeOfTransport: dto.modeOfTransport || 'OCEAN',
        inputContext: dto.inputContext || {},
        formulaRaw: manualFormulaRaw,
        formulaNormalized: normalizedManualFormula || undefined,
        extractionMethod: 'MANUAL',
        extractionConfidence: 1,
        parserVersion: 'manual-review-v1',
        sourceUrl: dto.sourceUrl,
        evidence: {
          ...(dto.evidence || {}),
          mode: 'manual-review',
          capturedBy: observedBy || null,
          capturedAt: new Date().toISOString(),
        },
        upsertLatest: true,
      },
      observedBy,
    );

    const comparison = await this.compareWithLiveFormula({
      provider: dto.provider,
      htsNumber: dto.htsNumber,
      countryCode: dto.countryCode,
      entryDate: dto.entryDate,
      modeOfTransport: dto.modeOfTransport || 'OCEAN',
    });

    const analysis =
      (dto.autoAnalyze ?? true) && !comparison.comparison.isMatch
        ? (
            await this.analyzeDiscrepancy({
              provider: dto.provider,
              htsNumber: dto.htsNumber,
              countryCode: dto.countryCode,
              entryDate: dto.entryDate,
              modeOfTransport: dto.modeOfTransport || 'OCEAN',
            })
          ).analysis
        : null;

    return {
      snapshotAction: upsertResult.action,
      contextHash: upsertResult.contextHash,
      previousId: upsertResult.previousId,
      snapshot: upsertResult.data,
      comparison,
      analysis,
    };
  }

  async reviewSnapshot(
    id: string,
    dto: ReviewExternalProviderFormulaDto,
    reviewedBy?: string,
  ): Promise<ExternalProviderFormulaEntity> {
    const snapshot = await this.findOne(id);

    if (snapshot.reviewStatus === 'PUBLISHED') {
      throw new BadRequestException(
        'Published snapshot cannot be reviewed again.',
      );
    }

    snapshot.reviewStatus = dto.decision;
    snapshot.reviewDecisionComment = dto.comment || null;
    snapshot.reviewedBy = reviewedBy || snapshot.reviewedBy || null;
    snapshot.reviewedAt = new Date();

    return this.externalFormulaRepo.save(snapshot);
  }

  async publishFormulaOverrideFromSnapshot(
    id: string,
    dto: PublishExternalProviderFormulaDto,
    publishedBy?: string,
  ): Promise<{
    snapshot: ExternalProviderFormulaEntity;
    formulaUpdate: {
      id: string;
      htsNumber: string;
      countryCode: string;
      formulaType: string;
      updateVersion: string;
    };
    livePatch: {
      htsId: string | null;
      sourceVersion: string | null;
      patched: boolean;
    };
  }> {
    const snapshot = await this.findOne(id);
    const formula = snapshot.formulaNormalized || snapshot.formulaRaw || null;

    if (!formula) {
      throw new BadRequestException(
        'Cannot publish override: snapshot formula is empty.',
      );
    }
    if (snapshot.reviewStatus === 'REJECTED') {
      throw new BadRequestException(
        'Cannot publish override from a rejected snapshot.',
      );
    }
    if (!['APPROVED', 'PUBLISHED'].includes(snapshot.reviewStatus || '')) {
      throw new BadRequestException(
        `Snapshot must be APPROVED before publish. Current status=${snapshot.reviewStatus || 'PENDING'}.`,
      );
    }

    const activeHts = await this.htsRepo.findOne({
      where: { htsNumber: snapshot.htsNumber, isActive: true },
      order: { updatedAt: 'DESC', importDate: 'DESC' },
    });
    const inferredFormulaType =
      await this.inferFormulaTypeForSnapshot(snapshot);
    const formulaType = (dto.formulaType || inferredFormulaType).toUpperCase();
    const updateVersion =
      dto.updateVersion ||
      activeHts?.sourceVersion ||
      activeHts?.version ||
      'GLOBAL';

    const formulaUpdate = await this.formulaUpdateService.upsert({
      htsNumber: snapshot.htsNumber,
      countryCode: snapshot.countryCode,
      formulaType,
      formula,
      formulaVariables: undefined,
      comment:
        dto.comment ||
        `Published from ${snapshot.provider} snapshot ${snapshot.id} on ${new Date().toISOString()}`,
      active: true,
      carryover: dto.carryover ?? true,
      overrideExtraTax: dto.overrideExtraTax ?? false,
      updateVersion,
    });

    const livePatch = await this.applyOverrideToActiveHts(
      snapshot.htsNumber,
      snapshot.countryCode,
      formulaType,
      formula,
      dto.comment || null,
    );

    snapshot.reviewStatus = 'PUBLISHED';
    snapshot.reviewDecisionComment =
      dto.comment || snapshot.reviewDecisionComment || null;
    snapshot.reviewedAt = snapshot.reviewedAt || new Date();
    snapshot.reviewedBy = snapshot.reviewedBy || publishedBy || null;
    snapshot.publishedFormulaUpdateId = formulaUpdate.id;
    snapshot.publishedBy = publishedBy || null;
    snapshot.publishedAt = new Date();
    snapshot.publishMetadata = {
      formulaType,
      updateVersion,
      carryover: dto.carryover ?? true,
      overrideExtraTax: dto.overrideExtraTax ?? false,
      livePatch,
    };

    const savedSnapshot = await this.externalFormulaRepo.save(snapshot);

    return {
      snapshot: savedSnapshot,
      formulaUpdate: {
        id: formulaUpdate.id,
        htsNumber: formulaUpdate.htsNumber,
        countryCode: formulaUpdate.countryCode,
        formulaType: formulaUpdate.formulaType,
        updateVersion: formulaUpdate.updateVersion,
      },
      livePatch,
    };
  }

  async analyzeDiscrepancy(
    dto: AnalyzeExternalProviderDiscrepancyDto,
  ): Promise<{
    comparison: LiveComparisonResult;
    analysis: {
      summary: string;
      probableCauses: string[];
      recommendedActions: string[];
      confidence: number;
      provider: 'ai' | 'rules';
    };
  }> {
    const comparison = await this.compareWithLiveFormula({
      provider: dto.provider,
      htsNumber: dto.htsNumber,
      countryCode: dto.countryCode,
      entryDate: dto.entryDate,
      modeOfTransport: dto.modeOfTransport,
    });

    const fallback = this.buildRuleBasedAnalysis(comparison);
    if (comparison.comparison.isMatch) {
      return {
        comparison,
        analysis: fallback,
      };
    }

    if (!process.env.OPENAI_API_KEY) {
      return {
        comparison,
        analysis: fallback,
      };
    }

    try {
      const openAiService = new OpenAiService();
      const prompt = [
        'Analyze discrepancy between external tariff provider and internal HTS formula.',
        `Provider formula: ${comparison.comparison.providerNormalized || 'N/A'}`,
        `Live formula: ${comparison.comparison.liveNormalized || 'N/A'}`,
        `Mismatch reason: ${comparison.comparison.mismatchReason}`,
        `Live formula type: ${comparison.liveHts?.selectedFormulaType || 'N/A'}`,
        `Live rate text: ${comparison.liveHts?.selectedRateText || 'N/A'}`,
      ].join('\n');

      const response = await openAiService.response(prompt, {
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_output_tokens: 500,
        text: {
          format: {
            type: 'json_schema',
            name: 'external_provider_discrepancy_analysis',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: [
                'summary',
                'probableCauses',
                'recommendedActions',
                'confidence',
              ],
              properties: {
                summary: { type: 'string' },
                probableCauses: {
                  type: 'array',
                  items: { type: 'string' },
                  minItems: 1,
                  maxItems: 6,
                },
                recommendedActions: {
                  type: 'array',
                  items: { type: 'string' },
                  minItems: 1,
                  maxItems: 6,
                },
                confidence: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1,
                },
              },
            },
            strict: true,
          },
        },
      });

      const raw = (response as any)?.output_text || '';
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid AI analysis payload');
      }

      return {
        comparison,
        analysis: {
          summary: String(parsed.summary || fallback.summary),
          probableCauses: Array.isArray(parsed.probableCauses)
            ? parsed.probableCauses.map((value: any) => String(value))
            : fallback.probableCauses,
          recommendedActions: Array.isArray(parsed.recommendedActions)
            ? parsed.recommendedActions.map((value: any) => String(value))
            : fallback.recommendedActions,
          confidence:
            typeof parsed.confidence === 'number' &&
            Number.isFinite(parsed.confidence)
              ? Math.max(0, Math.min(1, parsed.confidence))
              : fallback.confidence,
          provider: 'ai',
        },
      };
    } catch (error: any) {
      this.logger.warn(
        `AI discrepancy analysis failed; fallback to rules: ${error?.message || 'unknown error'}`,
      );
      return {
        comparison,
        analysis: fallback,
      };
    }
  }

  private hashContext(
    provider: string,
    inputContext: Record<string, any>,
  ): string {
    const canonicalInput = JSON.stringify(this.normalizeJson(inputContext));
    return createHash('sha256')
      .update(`${provider}:${canonicalInput}`)
      .digest('hex');
  }

  private normalizeFormula(value: string | null): string | null {
    if (!value) return null;
    const normalized = value
      .replace(/\s+/g, ' ')
      .replace(/\s*([()+\-*/=,:])\s*/g, '$1')
      .trim()
      .toUpperCase();
    return normalized || null;
  }

  private projectLiveFormula(
    hts: HtsEntity | null,
    countryCode: string,
  ): LiveFormulaProjection {
    if (!hts) return null;

    const defaultNonNtr = ['CU', 'KP', 'RU', 'BY'];
    const nonNtrCountries = Array.isArray(hts.nonNtrApplicableCountries)
      ? hts.nonNtrApplicableCountries.map((value) =>
          String(value).trim().toUpperCase(),
        )
      : defaultNonNtr;
    const chapter99Countries = Array.isArray(hts.chapter99ApplicableCountries)
      ? hts.chapter99ApplicableCountries.map((value) =>
          String(value).trim().toUpperCase(),
        )
      : [];

    const isNonNtr = nonNtrCountries.includes(countryCode);
    const hasChapter99 = chapter99Countries.includes(countryCode);
    const specialRate = hts.specialRates?.[countryCode] || null;

    if (isNonNtr) {
      return {
        id: hts.id,
        htsNumber: hts.htsNumber,
        rateFormula: hts.rateFormula || null,
        adjustedFormula: hts.adjustedFormula || null,
        otherRateFormula: hts.otherRateFormula || null,
        chapter99ApplicableCountries:
          chapter99Countries.length > 0 ? chapter99Countries : null,
        nonNtrApplicableCountries:
          nonNtrCountries.length > 0 ? nonNtrCountries : null,
        selectedFormulaType: 'NON_NTR',
        selectedFormula: hts.otherRateFormula || null,
        selectedRateText: hts.otherRate || null,
        selectedSpecialRate: specialRate,
      };
    }

    if (hasChapter99) {
      return {
        id: hts.id,
        htsNumber: hts.htsNumber,
        rateFormula: hts.rateFormula || null,
        adjustedFormula: hts.adjustedFormula || null,
        otherRateFormula: hts.otherRateFormula || null,
        chapter99ApplicableCountries:
          chapter99Countries.length > 0 ? chapter99Countries : null,
        nonNtrApplicableCountries:
          nonNtrCountries.length > 0 ? nonNtrCountries : null,
        selectedFormulaType: 'CHAPTER99',
        selectedFormula: hts.adjustedFormula || hts.rateFormula || null,
        selectedRateText: hts.chapter99 || hts.generalRate || null,
        selectedSpecialRate: specialRate,
      };
    }

    if (specialRate) {
      return {
        id: hts.id,
        htsNumber: hts.htsNumber,
        rateFormula: hts.rateFormula || null,
        adjustedFormula: hts.adjustedFormula || null,
        otherRateFormula: hts.otherRateFormula || null,
        chapter99ApplicableCountries:
          chapter99Countries.length > 0 ? chapter99Countries : null,
        nonNtrApplicableCountries:
          nonNtrCountries.length > 0 ? nonNtrCountries : null,
        selectedFormulaType: 'SPECIAL',
        selectedFormula: hts.rateFormula || null,
        selectedRateText: hts.generalRate || null,
        selectedSpecialRate: specialRate,
      };
    }

    return {
      id: hts.id,
      htsNumber: hts.htsNumber,
      rateFormula: hts.rateFormula || null,
      adjustedFormula: hts.adjustedFormula || null,
      otherRateFormula: hts.otherRateFormula || null,
      chapter99ApplicableCountries:
        chapter99Countries.length > 0 ? chapter99Countries : null,
      nonNtrApplicableCountries:
        nonNtrCountries.length > 0 ? nonNtrCountries : null,
      selectedFormulaType: 'GENERAL',
      selectedFormula: hts.rateFormula || null,
      selectedRateText: hts.generalRate || null,
      selectedSpecialRate: specialRate,
    };
  }

  private mapLiveTypeToOverrideType(
    selectedType:
      | 'GENERAL'
      | 'CHAPTER99'
      | 'NON_NTR'
      | 'SPECIAL'
      | null
      | undefined,
  ): 'GENERAL' | 'OTHER' | 'ADJUSTED' | 'OTHER_CHAPTER99' {
    if (selectedType === 'NON_NTR') {
      return 'OTHER';
    }
    if (selectedType === 'CHAPTER99') {
      return 'ADJUSTED';
    }
    return 'GENERAL';
  }

  private async inferFormulaTypeForSnapshot(
    snapshot: ExternalProviderFormulaEntity,
  ): Promise<'GENERAL' | 'OTHER' | 'ADJUSTED' | 'OTHER_CHAPTER99'> {
    const comparison = await this.compareWithLiveFormula({
      provider: snapshot.provider,
      htsNumber: snapshot.htsNumber,
      countryCode: snapshot.countryCode,
      entryDate: snapshot.entryDate,
      modeOfTransport: snapshot.modeOfTransport,
    });
    return this.mapLiveTypeToOverrideType(
      comparison.liveHts?.selectedFormulaType || null,
    );
  }

  private async applyOverrideToActiveHts(
    htsNumber: string,
    countryCode: string,
    formulaType: string,
    formula: string,
    comment: string | null,
  ): Promise<{
    htsId: string | null;
    sourceVersion: string | null;
    patched: boolean;
  }> {
    const hts = await this.htsRepo.findOne({
      where: { htsNumber, isActive: true },
      order: { updatedAt: 'DESC', importDate: 'DESC' },
    });

    if (!hts) {
      return { htsId: null, sourceVersion: null, patched: false };
    }

    const normalizedFormulaType = (formulaType || '').toUpperCase();
    if (normalizedFormulaType === 'OTHER') {
      hts.otherRateFormula = formula;
    } else if (normalizedFormulaType === 'ADJUSTED') {
      hts.adjustedFormula = formula;
      const countries = new Set(
        (hts.chapter99ApplicableCountries || []).map((code) =>
          code.toUpperCase(),
        ),
      );
      countries.add(countryCode.toUpperCase());
      hts.chapter99ApplicableCountries = Array.from(countries);
    } else if (normalizedFormulaType === 'OTHER_CHAPTER99') {
      const countries = new Set(
        (hts.otherChapter99Detail?.countries || []).map((code) =>
          code.toUpperCase(),
        ),
      );
      countries.add(countryCode.toUpperCase());
      hts.otherChapter99Detail = {
        ...(hts.otherChapter99Detail || {}),
        formula,
        variables: hts.otherChapter99Detail?.variables || undefined,
        countries: Array.from(countries),
      };
    } else {
      hts.rateFormula = formula;
    }

    hts.confirmed = true;
    hts.requiredReview = false;
    hts.updateFormulaComment =
      comment ||
      `Manual external-provider override published (${normalizedFormulaType})`;
    hts.metadata = {
      ...(hts.metadata || {}),
      manualOverride: true,
      manualOverrideAt: new Date().toISOString(),
      manualOverrideSource: 'external_provider_review',
      manualOverrideFormulaType: normalizedFormulaType,
    };

    const saved = await this.htsRepo.save(hts);
    return {
      htsId: saved.id,
      sourceVersion: saved.sourceVersion || saved.version || null,
      patched: true,
    };
  }

  private async fetchProviderSnapshot(
    dto: ValidateExternalProviderFormulaDto,
  ): Promise<ProviderFetchResult> {
    const provider = (dto.provider || '').trim().toUpperCase();
    if (provider === 'FLEXPORT') {
      return this.fetchFlexportSnapshot(dto);
    }

    throw new BadRequestException(`Unsupported external provider: ${provider}`);
  }

  private async fetchFlexportSnapshot(
    dto: ValidateExternalProviderFormulaDto,
  ): Promise<ProviderFetchResult> {
    const provider = 'FLEXPORT';
    const htsNumber = (dto.htsNumber || '').trim();
    const countryCode = (dto.countryCode || '').trim().toUpperCase();
    const entryDate = dto.entryDate;
    const modeOfTransport = (dto.modeOfTransport || 'OCEAN')
      .trim()
      .toUpperCase();

    const inputContext = this.normalizeJson({
      value: dto.value ?? null,
      productName: dto.productName || null,
      modeOfTransport,
      ...(dto.inputContext || {}),
    });

    const sourceUrl = this.buildFlexportUrl({
      htsNumber,
      countryCode,
      entryDate,
      modeOfTransport,
      value: dto.value,
      productName: dto.productName,
      inputContext,
    });

    const useMock =
      dto.useMock === true ||
      process.env.EXTERNAL_PROVIDER_FLEXPORT_MOCK === 'true';

    if (useMock) {
      const formulaRaw = this.buildMockFlexportFormula(countryCode);
      return {
        provider,
        htsNumber,
        countryCode,
        entryDate,
        modeOfTransport,
        inputContext,
        formulaRaw,
        formulaNormalized: this.normalizeFormula(formulaRaw),
        formulaComponents: {
          base: 'VALUE',
          rate: countryCode === 'CN' ? '0.125' : '0.05',
        },
        outputBreakdown: {
          mode: 'mock',
          value: dto.value ?? null,
          country: countryCode,
        },
        extractionMethod: 'API',
        extractionConfidence: 1,
        parserVersion: 'flexport-mock-v1',
        sourceUrl,
        evidence: {
          mode: 'mock',
          reason:
            'EXTERNAL_PROVIDER_FLEXPORT_MOCK=true or request.useMock=true',
        },
      };
    }

    const useAiExtraction =
      dto.useAiExtraction !== false &&
      process.env.EXTERNAL_PROVIDER_AI_EXTRACTION !== 'false';
    const startupDelayMs = this.readIntEnv(
      'EXTERNAL_PROVIDER_FLEXPORT_REQUEST_DELAY_MS',
      0,
    );
    const postLoadWaitMs = this.readIntEnv(
      'EXTERNAL_PROVIDER_FLEXPORT_POST_LOAD_WAIT_MS',
      5000,
    );
    const navTimeoutMs = this.readIntEnv(
      'EXTERNAL_PROVIDER_FLEXPORT_NAV_TIMEOUT_MS',
      90000,
    );
    const maxRetries = this.readIntEnv(
      'EXTERNAL_PROVIDER_FLEXPORT_MAX_RETRIES',
      2,
    );
    const retryDelayMs = this.readIntEnv(
      'EXTERNAL_PROVIDER_FLEXPORT_RETRY_DELAY_MS',
      8000,
    );
    const maxAttempts = Math.max(1, maxRetries + 1);
    let lastResult: ProviderFetchResult | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let browser: any = null;
      try {
        if (startupDelayMs > 0) {
          await this.sleep(startupDelayMs);
        }

        const puppeteer = await import('puppeteer');
        browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const page = await browser.newPage();
        await page.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        );

        const responsePayloads: Array<{ url: string; payload: any }> = [];
        page.on('response', async (response) => {
          try {
            const headers = response.headers();
            const contentType = (headers['content-type'] || '').toLowerCase();
            if (!contentType.includes('application/json')) {
              return;
            }

            const url = response.url();
            const payload = await response.json();
            responsePayloads.push({ url, payload });
          } catch {
            // Ignore payload extraction failures.
          }
        });

        await page.goto(sourceUrl, {
          waitUntil: 'networkidle2',
          timeout: navTimeoutMs,
        });
        await this.sleep(postLoadWaitMs);

        const html = await page.content();
        const bodyText = await page.evaluate(
          () => document.body?.innerText || '',
        );
        const formulaFromJson =
          this.findFormulaFromJsonPayloads(responsePayloads);
        const formulaFromDom = this.findFormulaFromDomText(bodyText);
        const formulaFromHtml = this.findFormulaFromHtmlText(html);
        let formulaRaw = formulaFromJson || formulaFromDom || formulaFromHtml;
        let extractionMethod: ProviderFetchResult['extractionMethod'] =
          formulaFromJson ? 'NETWORK' : 'DOM';
        let confidence = formulaFromJson
          ? 0.95
          : formulaFromDom || formulaFromHtml
            ? 0.7
            : 0.15;
        let aiEvidence: Record<string, any> | null = null;

        if (!formulaRaw && useAiExtraction) {
          const aiResult = await this.extractFormulaWithAi({
            htsNumber,
            countryCode,
            entryDate,
            bodyText,
            payloads: responsePayloads,
          });

          aiEvidence = {
            attempted: true,
            confidence: aiResult?.confidence ?? 0,
            signalsUsed: aiResult?.signalsUsed ?? 0,
            reason: aiResult?.reason || 'NO_RESULT',
            extracted: !!aiResult?.formulaRaw,
          };

          if (aiResult?.formulaRaw) {
            formulaRaw = aiResult.formulaRaw;
            extractionMethod = 'AI';
            confidence = Math.max(0.55, aiResult.confidence);
          }
        } else if (useAiExtraction) {
          aiEvidence = {
            attempted: false,
            reason: 'SKIPPED_DIRECT_EXTRACTION_ALREADY_FOUND',
            extracted: false,
          };
        } else {
          aiEvidence = {
            attempted: false,
            reason: 'DISABLED',
            extracted: false,
          };
        }

        const normalized = this.normalizeFormula(formulaRaw);
        const breakdown = this.findBreakdownFromJsonPayloads(responsePayloads);
        const evidence = {
          jsonResponseCount: responsePayloads.length,
          responseUrls: responsePayloads.map((item) => item.url).slice(0, 20),
          aiFallback: aiEvidence,
          challengeDetected: this.looksLikeBotProtectionPage(
            `${bodyText}\n${html}`,
          ),
          domTextSample: bodyText.slice(0, 2000),
          htmlSample: html.slice(0, 2000),
          attempt,
          maxAttempts,
        };

        const result: ProviderFetchResult = {
          provider,
          htsNumber,
          countryCode,
          entryDate,
          modeOfTransport,
          inputContext,
          formulaRaw,
          formulaNormalized: normalized,
          formulaComponents: normalized
            ? {
                source:
                  extractionMethod === 'NETWORK'
                    ? 'json_payload'
                    : extractionMethod === 'AI'
                      ? 'ai_inference'
                      : 'dom_or_html_text',
                normalized,
              }
            : null,
          outputBreakdown: breakdown,
          extractionMethod,
          extractionConfidence: confidence,
          parserVersion: useAiExtraction
            ? 'flexport-puppeteer-ai-v2'
            : 'flexport-puppeteer-v2',
          sourceUrl,
          evidence,
        };

        const shouldRetry =
          attempt < maxAttempts &&
          !result.formulaNormalized &&
          (this.isLikelyProviderBlockEvidence(evidence) ||
            Number(evidence.jsonResponseCount || 0) === 0);

        if (shouldRetry) {
          lastResult = result;
          const waitMs = retryDelayMs * attempt;
          this.logger.warn(
            `Flexport extraction retry ${attempt}/${maxAttempts} for ${htsNumber}/${countryCode}/${entryDate} after probable block/no-response (wait=${waitMs}ms)`,
          );
          if (waitMs > 0) {
            await this.sleep(waitMs);
          }
          continue;
        }

        return result;
      } catch (error: any) {
        this.logger.warn(
          `Flexport live extraction failed for ${htsNumber}/${countryCode}/${entryDate} (attempt ${attempt}/${maxAttempts}): ${error?.message || 'unknown error'}`,
        );
        lastResult = {
          provider,
          htsNumber,
          countryCode,
          entryDate,
          modeOfTransport,
          inputContext,
          formulaRaw: null,
          formulaNormalized: null,
          formulaComponents: null,
          outputBreakdown: null,
          extractionMethod: 'DOM',
          extractionConfidence: 0,
          parserVersion: useAiExtraction
            ? 'flexport-puppeteer-ai-v2'
            : 'flexport-puppeteer-v2',
          sourceUrl,
          evidence: {
            error: error?.message || 'unknown error',
            stack: error?.stack || null,
            attempt,
            maxAttempts,
          },
        };

        if (attempt < maxAttempts) {
          const waitMs = retryDelayMs * attempt;
          if (waitMs > 0) {
            await this.sleep(waitMs);
          }
          continue;
        }
      } finally {
        if (browser) {
          await browser.close();
        }
      }
    }

    if (lastResult) {
      return lastResult;
    }

    return {
      provider,
      htsNumber,
      countryCode,
      entryDate,
      modeOfTransport,
      inputContext,
      formulaRaw: null,
      formulaNormalized: null,
      formulaComponents: null,
      outputBreakdown: null,
      extractionMethod: 'DOM',
      extractionConfidence: 0,
      parserVersion: useAiExtraction
        ? 'flexport-puppeteer-ai-v2'
        : 'flexport-puppeteer-v2',
      sourceUrl,
      evidence: {
        error: 'unknown extraction failure',
      },
    };
  }

  private buildProviderExtractionFailureMessage(
    fetchResult: ProviderFetchResult,
  ): string {
    const baseMessage =
      'Provider formula extraction failed. No formula was retrieved from provider response.';
    const evidence = fetchResult.evidence || {};
    const likelyBlocked = this.isLikelyProviderBlockEvidence(evidence);
    if (likelyBlocked) {
      return `${baseMessage} Provider appears to have blocked automated access (CloudFront/anti-bot).`;
    }

    const aiReason =
      evidence?.aiFallback && typeof evidence.aiFallback.reason === 'string'
        ? evidence.aiFallback.reason
        : null;
    if (aiReason) {
      return `${baseMessage} AI fallback reason=${aiReason}.`;
    }

    if (typeof evidence?.error === 'string' && evidence.error.trim()) {
      return `${baseMessage} Provider fetch error=${evidence.error}.`;
    }

    return baseMessage;
  }

  private buildMockFlexportFormula(countryCode: string): string {
    if (countryCode === 'CN') {
      return 'VALUE * (0.05 + 0.075)';
    }

    return 'VALUE * 0.05';
  }

  private buildFlexportUrl(input: {
    htsNumber: string;
    countryCode: string;
    entryDate: string;
    modeOfTransport: string;
    value?: number;
    productName?: string;
    inputContext?: Record<string, any>;
  }): string {
    const params = new URLSearchParams();
    params.set('htsCode', input.htsNumber);
    params.set('entryDate', input.entryDate);
    params.set('country', input.countryCode);
    params.set('modeOfTransport', input.modeOfTransport);
    params.set('advanced', 'true');

    if (typeof input.value === 'number') {
      params.set('value', `${input.value}`);
    }

    if (input.productName) {
      params.set('name', input.productName);
    }

    const chapter99Selections = input.inputContext?.chapter99Selections;
    if (chapter99Selections && typeof chapter99Selections === 'object') {
      params.set('FIELD_CHOSEN_HTS_CODES', JSON.stringify(chapter99Selections));
    }

    const spiSelections = input.inputContext?.spiSelections;
    if (spiSelections && typeof spiSelections === 'object') {
      params.set('FIELD_CHOSEN_SPIS', JSON.stringify(spiSelections));
    }

    const dateOfLoading = input.inputContext?.dateOfLoading || input.entryDate;
    if (dateOfLoading) {
      params.set(
        'FIELD_DATE_OF_LOADING',
        JSON.stringify(String(dateOfLoading)),
      );
    }

    return `https://tariffs.flexport.com/?${params.toString()}`;
  }

  private findFormulaFromJsonPayloads(
    payloads: Array<{ url: string; payload: any }>,
  ): string | null {
    for (const payload of payloads) {
      const candidate = this.findFormulaInJsonNode(payload.payload, 0);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }

  private findFormulaInJsonNode(node: any, depth: number): string | null {
    if (depth > 8 || node == null) {
      return null;
    }

    if (typeof node === 'string') {
      const trimmed = node.trim();
      if (!trimmed) return null;
      if (
        /value\s*[*+/\-]/i.test(trimmed) ||
        /duty provided in the applicable subheading/i.test(trimmed)
      ) {
        return trimmed;
      }
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = this.findFormulaInJsonNode(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    if (typeof node === 'object') {
      const formulaLikeKeys = [
        'formula',
        'rateFormula',
        'calculationFormula',
        'adjustedFormula',
        'equation',
        'dutyFormula',
      ];

      for (const key of Object.keys(node)) {
        const value = node[key];
        if (
          formulaLikeKeys.includes(key) &&
          typeof value === 'string' &&
          value.trim()
        ) {
          return value.trim();
        }
      }

      for (const key of Object.keys(node)) {
        const found = this.findFormulaInJsonNode(node[key], depth + 1);
        if (found) return found;
      }
    }

    return null;
  }

  private findBreakdownFromJsonPayloads(
    payloads: Array<{ url: string; payload: any }>,
  ): Record<string, any> | null {
    for (const payload of payloads) {
      const maybe = this.findBreakdownInJsonNode(payload.payload, 0);
      if (maybe) {
        return {
          sourceUrl: payload.url,
          ...maybe,
        };
      }
    }
    return null;
  }

  private findBreakdownInJsonNode(
    node: any,
    depth: number,
  ): Record<string, any> | null {
    if (depth > 7 || !node || typeof node !== 'object') {
      return null;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = this.findBreakdownInJsonNode(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    const keys = Object.keys(node);
    const hasRate = keys.some((key) => /rate|duty|tariff|tax/i.test(key));
    if (hasRate) {
      const compact: Record<string, any> = {};
      for (const key of keys.slice(0, 12)) {
        const value = node[key];
        if (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          value === null
        ) {
          compact[key] = value;
        }
      }
      if (Object.keys(compact).length > 0) {
        return compact;
      }
    }

    for (const key of keys) {
      const found = this.findBreakdownInJsonNode(node[key], depth + 1);
      if (found) return found;
    }
    return null;
  }

  private findFormulaFromDomText(text: string): string | null {
    if (!text) return null;

    const normalizedText = text.replace(/\s+/g, ' ').trim();
    const additiveDutyMatch = normalizedText.match(
      /duty provided in the applicable subheading\s*\+\s*(\d+(?:\.\d+)?)%/i,
    );
    if (additiveDutyMatch) {
      return `THE DUTY PROVIDED IN THE APPLICABLE SUBHEADING + ${additiveDutyMatch[1]}%`;
    }

    const explicitPercentInSentenceMatch = normalizedText.match(
      /(?:additional duty|additional rate|additional tariff|plus)\s*(?:of\s*)?(\d+(?:\.\d+)?)%/i,
    );
    if (explicitPercentInSentenceMatch) {
      return `THE DUTY PROVIDED IN THE APPLICABLE SUBHEADING + ${explicitPercentInSentenceMatch[1]}%`;
    }

    const lineCandidates = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => /value|duty|tariff|tax|\+|\*/i.test(line));

    const formulaLike = lineCandidates.find((line) =>
      /value\s*[*+/\-]|\+\s*\d+(\.\d+)?%|ad valorem|duty provided in the applicable subheading/i.test(
        line,
      ),
    );
    if (formulaLike) {
      return formulaLike;
    }

    const percentCandidates = text.match(/\b\d+(\.\d+)?%\b/g);
    if (percentCandidates && percentCandidates.length > 0) {
      return `VALUE * (${percentCandidates[0].replace('%', '')} / 100)`;
    }

    return null;
  }

  private findFormulaFromHtmlText(html: string): string | null {
    if (!html) return null;

    const htmlWithoutTags = html.replace(/<[^>]+>/g, ' ');
    const normalized = htmlWithoutTags.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;

    const match = normalized.match(
      /(?:duty provided in the applicable subheading\s*\+\s*\d+(?:\.\d+)?%|\d+(?:\.\d+)?%\s*ad valorem)/i,
    );
    if (match) {
      return match[0];
    }

    return null;
  }

  private looksLikeBotProtectionPage(text: string): boolean {
    if (!text) return false;
    const normalized = text.toLowerCase();
    return (
      normalized.includes('verify you are human') ||
      normalized.includes('unusual traffic') ||
      normalized.includes('cloudflare') ||
      normalized.includes('cloudfront') ||
      normalized.includes('access denied') ||
      normalized.includes('enable javascript and cookies') ||
      normalized.includes('request blocked') ||
      normalized.includes('the request could not be satisfied') ||
      normalized.includes('generated by cloudfront')
    );
  }

  private isLikelyProviderBlockEvidence(
    evidence: Record<string, any> | null | undefined,
  ): boolean {
    if (!evidence || typeof evidence !== 'object') {
      return false;
    }

    if (evidence.challengeDetected === true) {
      return true;
    }

    const textCandidates = [
      evidence.domTextSample,
      evidence.htmlSample,
      evidence.error,
    ]
      .filter((value) => typeof value === 'string')
      .join('\n');

    return this.looksLikeBotProtectionPage(textCandidates);
  }

  private collectFormulaSignalLines(
    bodyText: string,
    payloads: Array<{ url: string; payload: any }>,
  ): string[] {
    const output = new Set<string>();
    const includeLine = (line: string) => {
      const normalized = line.replace(/\s+/g, ' ').trim();
      if (!normalized) return;
      if (
        !/(duty|tariff|rate|tax|ad valorem|applicable subheading|%|\+|\*|value)/i.test(
          normalized,
        )
      ) {
        return;
      }
      if (normalized.length < 4 || normalized.length > 260) return;
      output.add(normalized);
    };

    for (const line of bodyText.split('\n')) {
      includeLine(line);
      if (output.size >= 120) break;
    }

    for (const payload of payloads.slice(0, 30)) {
      this.collectJsonSignalStrings(payload.payload, 0, includeLine, output);
      if (output.size >= 180) break;
    }

    return Array.from(output).slice(0, 180);
  }

  private collectJsonSignalStrings(
    node: any,
    depth: number,
    emit: (line: string) => void,
    collector: Set<string>,
  ): void {
    if (depth > 8 || node == null || collector.size >= 180) {
      return;
    }

    if (typeof node === 'string') {
      emit(node);
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        this.collectJsonSignalStrings(item, depth + 1, emit, collector);
        if (collector.size >= 180) return;
      }
      return;
    }

    if (typeof node === 'object') {
      for (const value of Object.values(node)) {
        this.collectJsonSignalStrings(value, depth + 1, emit, collector);
        if (collector.size >= 180) return;
      }
    }
  }

  private async extractFormulaWithAi(input: {
    htsNumber: string;
    countryCode: string;
    entryDate: string;
    bodyText: string;
    payloads: Array<{ url: string; payload: any }>;
  }): Promise<{
    formulaRaw: string | null;
    confidence: number;
    signalsUsed: number;
    reason: string;
  } | null> {
    if (!process.env.OPENAI_API_KEY) {
      return {
        formulaRaw: null,
        confidence: 0,
        signalsUsed: 0,
        reason: 'OPENAI_API_KEY_MISSING',
      };
    }

    const signals = this.collectFormulaSignalLines(
      input.bodyText,
      input.payloads,
    );
    if (signals.length === 0) {
      return {
        formulaRaw: null,
        confidence: 0,
        signalsUsed: 0,
        reason: 'NO_SIGNALS',
      };
    }

    try {
      const openAiService = new OpenAiService();
      const prompt = [
        'Extract the most explicit tariff formula text from provider evidence.',
        'Return null formula when no clear formula is present.',
        `HTS: ${input.htsNumber}`,
        `Country: ${input.countryCode}`,
        `Entry date: ${input.entryDate}`,
        'Signals:',
        ...signals.map((line, index) => `${index + 1}. ${line}`),
      ].join('\n');

      const response = await openAiService.response(prompt, {
        model: 'gpt-4o-mini',
        temperature: 0,
        max_output_tokens: 300,
        text: {
          format: {
            type: 'json_schema',
            name: 'provider_formula_extraction',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['formulaRaw', 'confidence'],
              properties: {
                formulaRaw: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                },
                confidence: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1,
                },
              },
            },
            strict: true,
          },
        },
      });

      const raw = (response as any)?.output_text || '';
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') {
        return {
          formulaRaw: null,
          confidence: 0,
          signalsUsed: signals.length,
          reason: 'INVALID_AI_PAYLOAD',
        };
      }

      const formulaRaw =
        typeof parsed.formulaRaw === 'string' ? parsed.formulaRaw.trim() : null;
      const confidence =
        typeof parsed.confidence === 'number' &&
        Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0;

      if (!formulaRaw || formulaRaw.length > 400) {
        return {
          formulaRaw: null,
          confidence,
          signalsUsed: signals.length,
          reason: !formulaRaw ? 'AI_RETURNED_EMPTY' : 'AI_FORMULA_TOO_LONG',
        };
      }

      const minimumConfidence = this.readIntEnv(
        'EXTERNAL_PROVIDER_AI_MIN_CONFIDENCE_PERCENT',
        55,
      );
      const minimumConfidenceNormalized = Math.max(
        0,
        Math.min(1, minimumConfidence / 100),
      );
      if (confidence < minimumConfidenceNormalized) {
        return {
          formulaRaw: null,
          confidence,
          signalsUsed: signals.length,
          reason: 'LOW_CONFIDENCE',
        };
      }

      return {
        formulaRaw,
        confidence,
        signalsUsed: signals.length,
        reason: 'EXTRACTED',
      };
    } catch (error: any) {
      this.logger.warn(
        `AI provider formula extraction fallback failed: ${error?.message || 'unknown error'}`,
      );
      return {
        formulaRaw: null,
        confidence: 0,
        signalsUsed: signals.length,
        reason: 'AI_EXCEPTION',
      };
    }
  }

  private readIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw || !raw.trim()) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.floor(parsed);
  }

  private sleep(ms: number): Promise<void> {
    if (!ms || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildRuleBasedAnalysis(comparison: LiveComparisonResult): {
    summary: string;
    probableCauses: string[];
    recommendedActions: string[];
    confidence: number;
    provider: 'rules';
  } {
    const mismatchReason = comparison.comparison.mismatchReason;

    if (mismatchReason === 'MATCH') {
      return {
        summary: 'External provider formula and live HTS formula are aligned.',
        probableCauses: ['No discrepancy detected for the selected context.'],
        recommendedActions: [
          'Keep periodic validation enabled for new entry dates and policy updates.',
        ],
        confidence: 0.99,
        provider: 'rules',
      };
    }

    if (mismatchReason === 'NO_PROVIDER_SNAPSHOT') {
      return {
        summary:
          'No provider snapshot exists for the selected HTS/country/date context.',
        probableCauses: [
          'Validation has not been executed for this context.',
          'Snapshot may have been filtered by mode-of-transport mismatch.',
        ],
        recommendedActions: [
          'Run provider validation to fetch and persist a snapshot.',
          'Verify provider, country code, entry date, and transport mode inputs.',
        ],
        confidence: 0.9,
        provider: 'rules',
      };
    }

    if (mismatchReason === 'NO_PROVIDER_FORMULA') {
      return {
        summary: 'Provider snapshot exists, but formula extraction is empty.',
        probableCauses: [
          'Provider UI changed and current parser no longer captures formula fields.',
          'Provider returned only computed totals without explicit formula text.',
        ],
        recommendedActions: [
          'Inspect extraction evidence payload and update parser selectors/JSON keys.',
          'Use manual snapshot capture for this case until parser is updated.',
        ],
        confidence: 0.82,
        provider: 'rules',
      };
    }

    if (mismatchReason === 'NO_LIVE_FORMULA') {
      return {
        summary:
          'Live HTS entry has no resolved formula for the selected context.',
        probableCauses: [
          'Formula generation pipeline did not populate this HTS entry.',
          'Selected formula type resolved to a null path (e.g., chapter99/non-NTR branch missing).',
        ],
        recommendedActions: [
          'Re-run formula generation for the target HTS entry.',
          'Check chapter99 and non-NTR applicability columns for country mapping.',
        ],
        confidence: 0.88,
        provider: 'rules',
      };
    }

    return {
      summary: 'External provider formula differs from live HTS formula.',
      probableCauses: [
        'Different duty components selected (general vs chapter99 vs non-NTR vs special).',
        'Entry-date policy differences or provider update not yet synced.',
        'Formula normalization differences (equivalent math represented differently).',
      ],
      recommendedActions: [
        'Compare provider breakdown with live selected formula type and rate text.',
        'Validate chapter99/non-NTR country mapping and extra-tax linkage.',
        'If confirmed discrepancy, trigger HTS formula correction workflow and re-validate.',
      ],
      confidence: 0.75,
      provider: 'rules',
    };
  }

  private normalizeJson(value: any): any {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeJson(item));
    }

    if (value && typeof value === 'object') {
      const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
      const output: Record<string, any> = {};
      for (const key of keys) {
        output[key] = this.normalizeJson(value[key]);
      }
      return output;
    }

    return value;
  }

  private hasSnapshotChanged(
    latest: ExternalProviderFormulaEntity,
    current: {
      formulaRaw: string | null;
      formulaNormalized: string | null;
      formulaComponents: Record<string, any> | null;
      outputBreakdown: Record<string, any> | null;
      extractionMethod: string;
      parserVersion: string;
      sourceUrl: string;
    },
  ): boolean {
    if ((latest.formulaRaw || null) !== (current.formulaRaw || null)) {
      return true;
    }

    if (
      (latest.formulaNormalized || null) !== (current.formulaNormalized || null)
    ) {
      return true;
    }

    if ((latest.extractionMethod || '') !== (current.extractionMethod || '')) {
      return true;
    }

    if ((latest.parserVersion || '') !== (current.parserVersion || '')) {
      return true;
    }

    if ((latest.sourceUrl || '') !== (current.sourceUrl || '')) {
      return true;
    }

    const latestComponents = JSON.stringify(
      this.normalizeJson(latest.formulaComponents || null),
    );
    const currentComponents = JSON.stringify(
      this.normalizeJson(current.formulaComponents || null),
    );
    if (latestComponents !== currentComponents) {
      return true;
    }

    const latestBreakdown = JSON.stringify(
      this.normalizeJson(latest.outputBreakdown || null),
    );
    const currentBreakdown = JSON.stringify(
      this.normalizeJson(current.outputBreakdown || null),
    );
    if (latestBreakdown !== currentBreakdown) {
      return true;
    }

    return false;
  }
}
