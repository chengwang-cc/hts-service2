import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import {
  COUNTRY_TARIFF_PARSER_REGISTRY,
  CountryTariffParserRegistryEntry,
  CountryParserReadiness,
} from '../../jurisdiction/constants/country-tariff-parser-registry';
import { TariffCardShadowComparisonEntity } from '../../calculator/entities/tariff-card-shadow-comparison.entity';
import { TariffEvidenceEntity } from '../../calculator/entities/tariff-evidence.entity';
import { TariffKnowledgeCardEntity } from '../../calculator/entities/tariff-knowledge-card.entity';
import { BrokerGoldenSetCaseEntity } from '../entities/broker-golden-set-case.entity';
import { ExternalProviderQuoteEntity } from '../entities/external-provider-quote.entity';
import { FormulaAccuracyLabReportEntity } from '../entities/formula-accuracy-lab-report.entity';
import { PolicyChangeProposalEntity } from '../entities/policy-change-proposal.entity';
import { PolicyDocumentEntity } from '../entities/policy-document.entity';

type JsonObject = Record<string, unknown>;

export interface GenerateFormulaAccuracyLabReportOptions {
  reportDate?: string;
  windowDays?: number;
  dryRun?: boolean;
  metadata?: JsonObject | null;
}

@Injectable()
export class FormulaAccuracyLabService {
  constructor(
    @InjectRepository(FormulaAccuracyLabReportEntity)
    private readonly reportRepo: Repository<FormulaAccuracyLabReportEntity>,
    @InjectRepository(TariffEvidenceEntity)
    private readonly evidenceRepo: Repository<TariffEvidenceEntity>,
    @InjectRepository(TariffKnowledgeCardEntity)
    private readonly cardRepo: Repository<TariffKnowledgeCardEntity>,
    @InjectRepository(TariffCardShadowComparisonEntity)
    private readonly shadowRepo: Repository<TariffCardShadowComparisonEntity>,
    @InjectRepository(ExternalProviderQuoteEntity)
    private readonly quoteRepo: Repository<ExternalProviderQuoteEntity>,
    @InjectRepository(BrokerGoldenSetCaseEntity)
    private readonly brokerCaseRepo: Repository<BrokerGoldenSetCaseEntity>,
    @InjectRepository(PolicyDocumentEntity)
    private readonly documentRepo: Repository<PolicyDocumentEntity>,
    @InjectRepository(PolicyChangeProposalEntity)
    private readonly proposalRepo: Repository<PolicyChangeProposalEntity>,
  ) {}

  async latestReport(): Promise<FormulaAccuracyLabReportEntity | null> {
    return this.reportRepo.findOne({
      where: {},
      order: { createdAt: 'DESC' },
    });
  }

  async generateReport(
    options: GenerateFormulaAccuracyLabReportOptions = {},
  ): Promise<FormulaAccuracyLabReportEntity> {
    const now = new Date();
    const windowDays = Math.min(Math.max(options.windowDays ?? 7, 1), 90);
    const windowStartDate = this.subtractDays(now, windowDays);
    const reportDate = options.reportDate || this.dateOnly(now);
    const windowStart = this.dateOnly(windowStartDate);
    const windowEnd = this.dateOnly(now);

    const [
      evidenceCoverage,
      cardCoverage,
      shadowComparisons,
      providerOracle,
      brokerGoldenSet,
      policyChangeLatency,
      countryReadiness,
    ] = await Promise.all([
      this.evidenceCoverage(),
      this.cardCoverage(now),
      this.shadowComparisons(windowStartDate),
      this.providerOracle(windowStartDate),
      this.brokerGoldenSet(),
      this.policyChangeLatency(windowStartDate),
      this.countryReadiness(),
    ]);

    const summary = this.buildSummary({
      evidenceCoverage,
      cardCoverage,
      shadowComparisons,
      providerOracle,
      brokerGoldenSet,
      policyChangeLatency,
      countryReadiness,
    });
    const recommendations = this.buildRecommendations({
      evidenceCoverage,
      cardCoverage,
      shadowComparisons,
      providerOracle,
      brokerGoldenSet,
      countryReadiness,
    });

    const report = this.reportRepo.create({
      reportDate,
      windowStart,
      windowEnd,
      windowDays,
      status: 'generated',
      summary,
      evidenceCoverage,
      cardCoverage,
      shadowComparisons,
      providerOracle,
      brokerGoldenSet,
      policyChangeLatency,
      countryReadiness,
      recommendations,
      metadata: {
        source: 'formula-accuracy-lab',
        generatedAt: now.toISOString(),
        ...(options.metadata || {}),
      },
    });

    return options.dryRun ? report : this.reportRepo.save(report);
  }

  async dashboard(): Promise<JsonObject> {
    const latest = await this.latestReport();
    if (latest) {
      return {
        report: latest,
        generatedLive: false,
      };
    }
    return {
      report: await this.generateReport({ dryRun: true }),
      generatedLive: true,
    };
  }

  private async evidenceCoverage(): Promise<JsonObject> {
    const [
      total,
      accepted,
      byStatus,
      byValidationStatus,
      byCountryComponent,
      byParser,
      parserSamples,
    ] = await Promise.all([
        this.evidenceRepo.count(),
        this.evidenceRepo.count({ where: { status: 'accepted' } }),
        this.evidenceRepo
          .createQueryBuilder('evidence')
          .select('evidence.status', 'status')
          .addSelect('COUNT(*)', 'count')
          .groupBy('evidence.status')
          .orderBy('count', 'DESC')
          .getRawMany(),
        this.evidenceRepo
          .createQueryBuilder('evidence')
          .select('evidence.validationStatus', 'validationStatus')
          .addSelect('COUNT(*)', 'count')
          .groupBy('evidence.validationStatus')
          .orderBy('count', 'DESC')
          .getRawMany(),
        this.evidenceRepo
          .createQueryBuilder('evidence')
          .select('evidence.countryCode', 'countryCode')
          .addSelect('evidence.destinationCode', 'destinationCode')
          .addSelect('evidence.componentType', 'componentType')
          .addSelect('COUNT(*)', 'count')
          .addSelect('COUNT(evidence.compiledFormula)', 'compiledFormulaCount')
          .addSelect('COUNT(evidence.formulaAst)', 'formulaAstCount')
          .addSelect('COUNT(evidence.conditionAst)', 'conditionAstCount')
          .addSelect('COUNT(evidence.unitDimensions)', 'unitDimensionsCount')
          .addSelect('AVG(evidence.parserConfidence)', 'avgParserConfidence')
          .groupBy('evidence.countryCode')
          .addGroupBy('evidence.destinationCode')
          .addGroupBy('evidence.componentType')
          .orderBy('count', 'DESC')
          .limit(250)
          .getRawMany(),
        this.evidenceRepo
          .createQueryBuilder('evidence')
          .select('evidence.parserName', 'parserName')
          .addSelect('evidence.parserVersion', 'parserVersion')
          .addSelect('evidence.componentType', 'componentType')
          .addSelect('COUNT(*)', 'count')
          .addSelect(
            "COUNT(*) FILTER (WHERE evidence.validationStatus = 'valid')",
            'validCount',
          )
          .addSelect('AVG(evidence.parserConfidence)', 'avgParserConfidence')
          .groupBy('evidence.parserName')
          .addGroupBy('evidence.parserVersion')
          .addGroupBy('evidence.componentType')
          .orderBy('count', 'DESC')
          .limit(250)
          .getRawMany(),
        this.evidenceRepo
          .createQueryBuilder('evidence')
          .select('evidence.rateText', 'rateText')
          .addSelect('evidence.componentType', 'componentType')
          .addSelect('evidence.validationStatus', 'validationStatus')
          .addSelect('evidence.unitDimensions', 'unitDimensions')
          .addSelect('evidence.conditionAst', 'conditionAst')
          .orderBy('evidence.retrievedAt', 'DESC')
          .limit(10000)
          .getRawMany(),
      ]);

    const rows = byCountryComponent.map((row) => ({
      countryCode: row.countryCode,
      destinationCode: row.destinationCode,
      componentType: row.componentType,
      count: this.number(row.count),
      compiledFormulaCount: this.number(row.compiledFormulaCount),
      formulaAstCount: this.number(row.formulaAstCount),
      conditionAstCount: this.number(row.conditionAstCount),
      unitDimensionsCount: this.number(row.unitDimensionsCount),
      avgParserConfidence: this.optionalNumber(row.avgParserConfidence),
    }));
    const formulaRows = rows.filter((row) => row.compiledFormulaCount > 0);
    const conditionRows = rows.filter((row) => row.conditionAstCount > 0);
    const unitRows = rows.filter((row) => row.unitDimensionsCount > 0);

    return {
      total,
      accepted,
      acceptedRatio: this.ratio(accepted, total),
      statusCounts: this.countRows(byStatus, 'status'),
      validationStatusCounts: this.countRows(
        byValidationStatus,
        'validationStatus',
      ),
      formulaCoverageRatio: this.ratio(
        formulaRows.reduce((sum, row) => sum + row.compiledFormulaCount, 0),
        total,
      ),
      conditionCoverageRatio: this.ratio(
        conditionRows.reduce((sum, row) => sum + row.conditionAstCount, 0),
        total,
      ),
      unitCoverageRatio: this.ratio(
        unitRows.reduce((sum, row) => sum + row.unitDimensionsCount, 0),
        total,
      ),
      parserCoverage: {
        byParser: byParser.map((row) => ({
          parserName: row.parserName,
          parserVersion: row.parserVersion,
          componentType: row.componentType,
          count: this.number(row.count),
          validCount: this.number(row.validCount),
          validRatio: this.ratio(this.number(row.validCount), this.number(row.count)),
          avgParserConfidence: this.optionalNumber(row.avgParserConfidence),
        })),
        byPattern: this.parserCoverageRows(
          parserSamples,
          (row) => this.ratePatternTag(String(row.rateText || '')),
        ),
        byUnitDimension: this.parserCoverageRows(parserSamples, (row) =>
          this.unitDimensionTags(row.unitDimensions),
        ),
        byConditionKind: this.parserCoverageRows(parserSamples, (row) =>
          this.conditionKind(row.conditionAst),
        ),
      },
      byCountryComponent: rows,
    };
  }

  private async cardCoverage(now: Date): Promise<JsonObject> {
    const staleBefore = this.subtractDays(now, 30);
    const [total, stale, missingFormula, statusRows, countryRows] =
      await Promise.all([
        this.cardRepo.count(),
        this.cardRepo
          .createQueryBuilder('card')
          .where(
            '(card.lastReviewedAt IS NULL OR card.lastReviewedAt < :staleBefore)',
            { staleBefore },
          )
          .getCount(),
        this.cardRepo
          .createQueryBuilder('card')
          .where('card.consensusFormula IS NULL')
          .getCount(),
        this.cardRepo
          .createQueryBuilder('card')
          .select('card.status', 'status')
          .addSelect('COUNT(*)', 'count')
          .addSelect('AVG(card.confidenceScore)', 'avgConfidenceScore')
          .addSelect('AVG(card.agreementScore)', 'avgAgreementScore')
          .addSelect('SUM(card.evidenceCount)', 'evidenceCount')
          .addSelect('SUM(card.disagreementCount)', 'disagreementCount')
          .groupBy('card.status')
          .orderBy('count', 'DESC')
          .getRawMany(),
        this.cardRepo
          .createQueryBuilder('card')
          .select('card.countryCode', 'countryCode')
          .addSelect('card.destinationCode', 'destinationCode')
          .addSelect('COUNT(*)', 'count')
          .addSelect('AVG(card.confidenceScore)', 'avgConfidenceScore')
          .addSelect('AVG(card.agreementScore)', 'avgAgreementScore')
          .groupBy('card.countryCode')
          .addGroupBy('card.destinationCode')
          .orderBy('count', 'DESC')
          .limit(100)
          .getRawMany(),
      ]);

    const statusCounts = statusRows.map((row) => ({
      status: row.status,
      count: this.number(row.count),
      avgConfidenceScore: this.optionalNumber(row.avgConfidenceScore),
      avgAgreementScore: this.optionalNumber(row.avgAgreementScore),
      evidenceCount: this.number(row.evidenceCount),
      disagreementCount: this.number(row.disagreementCount),
    }));
    const avgConfidenceScore = this.weightedAverage(
      statusCounts,
      'avgConfidenceScore',
      'count',
    );
    const avgAgreementScore = this.weightedAverage(
      statusCounts,
      'avgAgreementScore',
      'count',
    );

    return {
      total,
      stale,
      staleRatio: this.ratio(stale, total),
      missingFormula,
      missingFormulaRatio: this.ratio(missingFormula, total),
      avgConfidenceScore,
      avgAgreementScore,
      statusCounts,
      byCountry: countryRows.map((row) => ({
        countryCode: row.countryCode,
        destinationCode: row.destinationCode,
        count: this.number(row.count),
        avgConfidenceScore: this.optionalNumber(row.avgConfidenceScore),
        avgAgreementScore: this.optionalNumber(row.avgAgreementScore),
      })),
    };
  }

  private async shadowComparisons(windowStart: Date): Promise<JsonObject> {
    const [total, windowTotal, statusRows, windowStatusRows, topMismatchRows] =
      await Promise.all([
        this.shadowRepo.count(),
        this.shadowRepo.count({
          where: { createdAt: MoreThanOrEqual(windowStart) },
        }),
        this.shadowRepo
          .createQueryBuilder('comparison')
          .select('comparison.status', 'status')
          .addSelect('COUNT(*)', 'count')
          .groupBy('comparison.status')
          .orderBy('count', 'DESC')
          .getRawMany(),
        this.shadowRepo
          .createQueryBuilder('comparison')
          .select('comparison.status', 'status')
          .addSelect('COUNT(*)', 'count')
          .where('comparison.createdAt >= :windowStart', { windowStart })
          .groupBy('comparison.status')
          .orderBy('count', 'DESC')
          .getRawMany(),
        this.shadowRepo
          .createQueryBuilder('comparison')
          .select('comparison.htsNumber', 'htsNumber')
          .addSelect('comparison.countryCode', 'countryCode')
          .addSelect('comparison.formulaType', 'formulaType')
          .addSelect('COUNT(*)', 'count')
          .where('comparison.status = :status', { status: 'pending' })
          .groupBy('comparison.htsNumber')
          .addGroupBy('comparison.countryCode')
          .addGroupBy('comparison.formulaType')
          .orderBy('count', 'DESC')
          .limit(25)
          .getRawMany(),
      ]);

    return {
      total,
      windowTotal,
      statusCounts: this.countRows(statusRows, 'status'),
      windowStatusCounts: this.countRows(windowStatusRows, 'status'),
      topPendingMismatches: topMismatchRows.map((row) => ({
        htsNumber: row.htsNumber,
        countryCode: row.countryCode,
        formulaType: row.formulaType,
        count: this.number(row.count),
      })),
    };
  }

  private async providerOracle(windowStart: Date): Promise<JsonObject> {
    const [
      total,
      windowTotal,
      agreementRows,
      providerRows,
      topDeltas,
      componentMismatchQuotes,
    ] = await Promise.all([
        this.quoteRepo.count(),
        this.quoteRepo.count({ where: { fetchedAt: MoreThanOrEqual(windowStart) } }),
        this.quoteRepo
          .createQueryBuilder('quote')
          .select('quote.agreementStatus', 'agreementStatus')
          .addSelect('COUNT(*)', 'count')
          .groupBy('quote.agreementStatus')
          .orderBy('count', 'DESC')
          .getRawMany(),
        this.quoteRepo
          .createQueryBuilder('quote')
          .select('quote.provider', 'provider')
          .addSelect('quote.originCountry', 'originCountry')
          .addSelect('quote.agreementStatus', 'agreementStatus')
          .addSelect('COUNT(*)', 'count')
          .addSelect('AVG(ABS(quote.delta))', 'avgAbsDelta')
          .where('quote.fetchedAt >= :windowStart', { windowStart })
          .groupBy('quote.provider')
          .addGroupBy('quote.originCountry')
          .addGroupBy('quote.agreementStatus')
          .orderBy('count', 'DESC')
          .limit(100)
          .getRawMany(),
        this.quoteRepo
          .createQueryBuilder('quote')
          .select('quote.provider', 'provider')
          .addSelect('quote.htsNumber', 'htsNumber')
          .addSelect('quote.originCountry', 'originCountry')
          .addSelect('quote.localTotalDuty', 'localTotalDuty')
          .addSelect('quote.providerTotalDuty', 'providerTotalDuty')
          .addSelect('quote.delta', 'delta')
          .where('quote.delta IS NOT NULL')
          .orderBy('ABS(quote.delta)', 'DESC')
          .limit(25)
          .getRawMany(),
        this.quoteRepo.find({
          where: {
            agreementStatus: 'mismatched',
            fetchedAt: MoreThanOrEqual(windowStart),
          },
          order: { fetchedAt: 'DESC' },
          take: 100,
        }),
      ]);

    const agreementCounts = this.countRows(agreementRows, 'agreementStatus');
    const matched = agreementCounts.find(
      (row) => row.agreementStatus === 'matched',
    )?.count as number | undefined;

    return {
      total,
      windowTotal,
      agreementCounts,
      matchedRatio: this.ratio(matched || 0, total),
      byProvider: providerRows.map((row) => ({
        provider: row.provider,
        originCountry: row.originCountry,
        agreementStatus: row.agreementStatus,
        count: this.number(row.count),
        avgAbsDelta: this.optionalNumber(row.avgAbsDelta),
      })),
      topDeltas: topDeltas.map((row) => ({
        provider: row.provider,
        htsNumber: row.htsNumber,
        originCountry: row.originCountry,
        localTotalDuty: this.optionalNumber(row.localTotalDuty),
        providerTotalDuty: this.optionalNumber(row.providerTotalDuty),
        delta: this.optionalNumber(row.delta),
      })),
      topComponentMismatches: this.providerComponentMismatches(
        componentMismatchQuotes,
      ),
    };
  }

  private async brokerGoldenSet(): Promise<JsonObject> {
    const row = await this.brokerCaseRepo
      .createQueryBuilder('brokerCase')
      .select('COUNT(*)', 'activeCases')
      .addSelect(
        "COUNT(*) FILTER (WHERE brokerCase.metadata -> 'lastValidation' ->> 'matched' = 'true')",
        'matched',
      )
      .addSelect(
        "COUNT(*) FILTER (WHERE brokerCase.metadata -> 'lastValidation' ->> 'matched' = 'false')",
        'mismatched',
      )
      .addSelect(
        "COUNT(*) FILTER (WHERE brokerCase.lastValidatedAt IS NULL)",
        'neverValidated',
      )
      .where('brokerCase.status = :status', { status: 'active' })
      .getRawOne<{
        activeCases: string;
        matched: string;
        mismatched: string;
        neverValidated: string;
      }>();

    const activeCases = this.number(row?.activeCases);
    const matched = this.number(row?.matched);
    const mismatched = this.number(row?.mismatched);
    const neverValidated = this.number(row?.neverValidated);

    return {
      activeCases,
      matched,
      mismatched,
      neverValidated,
      matchedRatio: this.ratio(matched, activeCases),
      neverValidatedRatio: this.ratio(neverValidated, activeCases),
    };
  }

  private async policyChangeLatency(windowStart: Date): Promise<JsonObject> {
    const [documentsFetched, proposalRows, latencyRow] = await Promise.all([
      this.documentRepo.count({
        where: { fetchedAt: MoreThanOrEqual(windowStart) },
      }),
      this.proposalRepo
        .createQueryBuilder('proposal')
        .select('proposal.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('proposal.createdAt >= :windowStart', { windowStart })
        .groupBy('proposal.status')
        .orderBy('count', 'DESC')
        .getRawMany(),
      this.proposalRepo
        .createQueryBuilder('proposal')
        .innerJoin('proposal.document', 'policyDocument')
        .select(
          'AVG(EXTRACT(EPOCH FROM (proposal.createdAt - policyDocument.fetchedAt)) / 3600)',
          'avgProposalLagHours',
        )
        .addSelect(
          'MAX(EXTRACT(EPOCH FROM (proposal.createdAt - policyDocument.fetchedAt)) / 3600)',
          'maxProposalLagHours',
        )
        .where('proposal.createdAt >= :windowStart', { windowStart })
        .getRawOne<{
          avgProposalLagHours: string | null;
          maxProposalLagHours: string | null;
        }>(),
    ]);

    return {
      documentsFetched,
      proposalStatusCounts: this.countRows(proposalRows, 'status'),
      avgProposalLagHours: this.optionalNumber(
        latencyRow?.avgProposalLagHours,
      ),
      maxProposalLagHours: this.optionalNumber(
        latencyRow?.maxProposalLagHours,
      ),
    };
  }

  private async countryReadiness(): Promise<JsonObject> {
    const evidenceByCountry = await this.evidenceRepo
      .createQueryBuilder('evidence')
      .select('evidence.countryCode', 'countryCode')
      .addSelect('COUNT(*)', 'evidenceCount')
      .addSelect('COUNT(DISTINCT evidence.htsNumber)', 'htsCount')
      .addSelect(
        "COUNT(*) FILTER (WHERE evidence.status = 'accepted' AND evidence.validationStatus = 'valid')",
        'acceptedValidEvidenceCount',
      )
      .addSelect(
        "COUNT(*) FILTER (WHERE evidence.validationStatus = 'valid')",
        'validEvidenceCount',
      )
      .groupBy('evidence.countryCode')
      .getRawMany();
    const cardByCountry = await this.cardRepo
      .createQueryBuilder('card')
      .select('card.countryCode', 'countryCode')
      .addSelect('COUNT(*)', 'cardCount')
      .addSelect(
        "COUNT(*) FILTER (WHERE card.status = 'authoritative')",
        'authoritativeCardCount',
      )
      .addSelect('AVG(card.confidenceScore)', 'avgConfidenceScore')
      .groupBy('card.countryCode')
      .getRawMany();

    const evidenceMap = new Map(
      evidenceByCountry.map((row) => [
        row.countryCode,
        {
          evidenceCount: this.number(row.evidenceCount),
          htsCount: this.number(row.htsCount),
          acceptedValidEvidenceCount: this.number(
            row.acceptedValidEvidenceCount,
          ),
          validEvidenceCount: this.number(row.validEvidenceCount),
        },
      ]),
    );
    const cardMap = new Map(
      cardByCountry.map((row) => [
        row.countryCode,
        {
          cardCount: this.number(row.cardCount),
          authoritativeCardCount: this.number(row.authoritativeCardCount),
          avgConfidenceScore: this.optionalNumber(row.avgConfidenceScore),
        },
      ]),
    );

    const countries = COUNTRY_TARIFF_PARSER_REGISTRY.map((entry) =>
      this.countryReadinessRow(entry, evidenceMap, cardMap),
    );

    return {
      countries,
      productionCount: countries.filter(
        (country) => country.readiness === 'production',
      ).length,
      shadowCount: countries.filter((country) => country.readiness === 'shadow')
        .length,
      pilotCount: countries.filter((country) => country.readiness === 'pilot')
        .length,
      plannedCount: countries.filter(
        (country) => country.readiness === 'planned',
      ).length,
    };
  }

  private countryReadinessRow(
    entry: CountryTariffParserRegistryEntry,
    evidenceMap: Map<
      string,
      {
        evidenceCount: number;
        htsCount: number;
        acceptedValidEvidenceCount: number;
        validEvidenceCount: number;
      }
    >,
    cardMap: Map<
      string,
      {
        cardCount: number;
        authoritativeCardCount: number;
        avgConfidenceScore: number | null;
      }
    >,
  ): JsonObject {
    const evidence = evidenceMap.get(entry.jurisdictionCode) || {
      evidenceCount: 0,
      htsCount: 0,
      acceptedValidEvidenceCount: 0,
      validEvidenceCount: 0,
    };
    const card = cardMap.get(entry.jurisdictionCode) || {
      cardCount: 0,
      authoritativeCardCount: 0,
      avgConfidenceScore: null,
    };
    const automationValues = Object.values(entry.automation);
    const aiAssistValues = Object.values(entry.aiAssist);
    const automationRatio = this.ratio(
      automationValues.filter(Boolean).length,
      automationValues.length,
    );
    const aiAssistRatio = this.ratio(
      aiAssistValues.filter(Boolean).length,
      aiAssistValues.length,
    );
    const parserPassRatio = this.ratio(
      evidence.validEvidenceCount,
      evidence.evidenceCount,
    );
    const gates = this.countryReadinessGates(
      entry,
      evidence,
      card,
      parserPassRatio,
    );

    return {
      ...entry,
      evidenceCount: evidence.evidenceCount,
      acceptedValidEvidenceCount: evidence.acceptedValidEvidenceCount,
      htsCount: evidence.htsCount,
      cardCount: card.cardCount,
      authoritativeCardCount: card.authoritativeCardCount,
      avgConfidenceScore: card.avgConfidenceScore,
      parserPassRatio,
      automationRatio,
      aiAssistRatio,
      readinessGates: gates,
      gatedReadiness: this.gatedReadiness(entry.readiness, gates),
    };
  }

  private countryReadinessGates(
    entry: CountryTariffParserRegistryEntry,
    evidence: {
      evidenceCount: number;
      htsCount: number;
      acceptedValidEvidenceCount: number;
    },
    card: {
      cardCount: number;
      authoritativeCardCount: number;
      avgConfidenceScore: number | null;
    },
    parserPassRatio: number,
  ): JsonObject {
    const target =
      entry.readiness === 'production'
        ? { evidence: 500, cards: 250, confidence: 0.9, parserPass: 0.98 }
        : entry.readiness === 'shadow'
          ? { evidence: 100, cards: 50, confidence: 0.8, parserPass: 0.95 }
          : entry.readiness === 'pilot'
            ? { evidence: 25, cards: 10, confidence: 0.7, parserPass: 0.9 }
            : { evidence: 1, cards: 1, confidence: 0.7, parserPass: 0.9 };

    const deterministicParserReady = entry.parserNames.length > 0;
    const evidenceReady = evidence.acceptedValidEvidenceCount >= target.evidence;
    const cardReady = card.authoritativeCardCount >= target.cards;
    const confidenceReady =
      (card.avgConfidenceScore || 0) >= target.confidence;
    const parserReady =
      deterministicParserReady && parserPassRatio >= target.parserPass;

    return {
      target,
      deterministicParserReady,
      evidenceReady,
      cardReady,
      confidenceReady,
      parserReady,
      evidenceBacked:
        evidence.acceptedValidEvidenceCount > 0 &&
        card.authoritativeCardCount > 0,
      blockedReason:
        evidenceReady && cardReady && confidenceReady && parserReady
          ? null
          : [
              !deterministicParserReady ? 'missing_deterministic_parser' : null,
              !evidenceReady ? 'insufficient_accepted_valid_evidence' : null,
              !cardReady ? 'insufficient_authoritative_cards' : null,
              !confidenceReady ? 'low_card_confidence' : null,
              !parserReady ? 'low_parser_pass_rate' : null,
            ].filter(Boolean),
    };
  }

  private gatedReadiness(
    readiness: CountryParserReadiness,
    gates: JsonObject,
  ): CountryParserReadiness {
    const blockedReasons = gates.blockedReason as string[] | null;
    if (!blockedReasons || blockedReasons.length === 0) {
      return readiness;
    }
    if (readiness === 'production') {
      return 'shadow';
    }
    if (readiness === 'shadow') {
      return 'pilot';
    }
    return 'planned';
  }

  private buildSummary(metrics: Record<string, JsonObject>): JsonObject {
    const evidenceCoverage = metrics.evidenceCoverage;
    const cardCoverage = metrics.cardCoverage;
    const shadowComparisons = metrics.shadowComparisons;
    const providerOracle = metrics.providerOracle;
    const brokerGoldenSet = metrics.brokerGoldenSet;

    const cardConfidence = this.number(
      cardCoverage.avgConfidenceScore,
      0.5,
    );
    const evidenceScore = this.number(
      evidenceCoverage.formulaCoverageRatio,
      0,
    );
    const providerScore =
      this.number(providerOracle.total) > 0
        ? this.number(providerOracle.matchedRatio)
        : 0.5;
    const brokerScore =
      this.number(brokerGoldenSet.activeCases) > 0
        ? this.number(brokerGoldenSet.matchedRatio)
        : 0.5;
    const shadowPenalty = Math.min(
      this.number(
        (shadowComparisons.statusCounts as Array<Record<string, unknown>>).find(
          (row) => row.status === 'pending',
        )?.count,
      ) * 0.002,
      0.2,
    );
    const score = this.clamp01(
      cardConfidence * 0.35 +
        evidenceScore * 0.25 +
        providerScore * 0.2 +
        brokerScore * 0.2 -
        shadowPenalty,
    );

    return {
      operationalAccuracyScore: this.round(score, 4),
      label:
        score >= 0.9
          ? 'high'
          : score >= 0.75
            ? 'medium'
            : score >= 0.5
              ? 'low'
              : 'review',
      cardConfidence,
      evidenceScore,
      providerScore,
      brokerScore,
      shadowPenalty,
      generatedBy: 'formula-accuracy-lab',
    };
  }

  private buildRecommendations(metrics: Record<string, JsonObject>) {
    const recommendations: Array<Record<string, unknown>> = [];
    const evidenceCoverage = metrics.evidenceCoverage;
    const cardCoverage = metrics.cardCoverage;
    const shadowComparisons = metrics.shadowComparisons;
    const providerOracle = metrics.providerOracle;
    const brokerGoldenSet = metrics.brokerGoldenSet;
    const countryReadiness = metrics.countryReadiness;

    if (this.number(evidenceCoverage.formulaCoverageRatio) < 0.95) {
      recommendations.push({
        priority: 'P1',
        area: 'evidence',
        action:
          'Increase deterministic parser coverage for evidence rows without compiled formulas.',
      });
    }
    if (this.number(cardCoverage.staleRatio) > 0.1) {
      recommendations.push({
        priority: 'P1',
        area: 'knowledge-cards',
        action:
          'Run tariff card recompute and reviewer triage for stale or unreviewed cards.',
      });
    }
    if (
      (shadowComparisons.statusCounts as Array<Record<string, unknown>>).some(
        (row) => row.status === 'pending' && this.number(row.count) > 0,
      )
    ) {
      recommendations.push({
        priority: 'P1',
        area: 'shadow-mode',
        action:
          'Resolve pending card-vs-legacy mismatches before raising card read mode.',
      });
    }
    if (
      this.number(providerOracle.total) > 0 &&
      this.number(providerOracle.matchedRatio) < 0.9
    ) {
      recommendations.push({
        priority: 'P2',
        area: 'provider-oracle',
        action:
          'Sample top provider deltas into broker golden-set cases and reconciliation packets.',
      });
    }
    if (this.number(brokerGoldenSet.activeCases) === 0) {
      recommendations.push({
        priority: 'P2',
        area: 'broker-golden-set',
        action:
          'Import broker-verified scenarios for high-volume chapters and high-risk countries.',
      });
    }
    const plannedCountries = (
      countryReadiness.countries as Array<Record<string, unknown>>
    ).filter((country) => country.readiness === 'planned');
    if (plannedCountries.length > 0) {
      recommendations.push({
        priority: 'P3',
        area: 'country-expansion',
        action:
          'Build deterministic adapters before allowing planned countries into production calculation.',
        countries: plannedCountries.map((country) => country.jurisdictionCode),
      });
    }

    return recommendations;
  }

  private countRows(rows: Array<Record<string, unknown>>, key: string) {
    return rows.map((row) => ({
      [key]: row[key],
      count: this.number(row.count),
    }));
  }

  private parserCoverageRows(
    rows: Array<Record<string, unknown>>,
    tagSelector: (row: Record<string, unknown>) => string | string[],
  ): Array<Record<string, unknown>> {
    const groups = new Map<
      string,
      { count: number; validCount: number; componentTypes: Set<string> }
    >();
    for (const row of rows) {
      const tags = tagSelector(row);
      const values = Array.isArray(tags) ? tags : [tags];
      for (const tag of values.filter(Boolean)) {
        const current = groups.get(tag) || {
          count: 0,
          validCount: 0,
          componentTypes: new Set<string>(),
        };
        current.count++;
        if (row.validationStatus === 'valid') {
          current.validCount++;
        }
        if (typeof row.componentType === 'string') {
          current.componentTypes.add(row.componentType);
        }
        groups.set(tag, current);
      }
    }
    return Array.from(groups.entries())
      .map(([tag, value]) => ({
        tag,
        count: value.count,
        validCount: value.validCount,
        validRatio: this.ratio(value.validCount, value.count),
        componentTypes: Array.from(value.componentTypes).sort(),
      }))
      .sort((a, b) => this.number(b.count) - this.number(a.count));
  }

  private providerComponentMismatches(
    quotes: ExternalProviderQuoteEntity[],
  ): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];
    for (const quote of quotes) {
      const comparison = quote.metadata?.componentComparison;
      if (!comparison || typeof comparison !== 'object') {
        continue;
      }
      const mismatches = (comparison as JsonObject).mismatches;
      if (!Array.isArray(mismatches) || mismatches.length === 0) {
        continue;
      }
      rows.push({
        quoteId: quote.id,
        provider: quote.provider,
        htsNumber: quote.htsNumber,
        originCountry: quote.originCountry,
        destinationCountry: quote.destinationCountry,
        delta: this.optionalNumber(quote.delta),
        mismatches: mismatches.slice(0, 10),
      });
      if (rows.length >= 25) {
        break;
      }
    }
    return rows;
  }

  private ratePatternTag(rateText: string): string {
    const text = rateText.toLowerCase();
    if (!text.trim()) return 'missing_rate_text';
    if (/^(free|0\s*%?)$/.test(text.trim())) return 'free';
    if (/\b(whichever|in lieu of)\b/.test(text)) return 'alternative_formula';
    if (/\b(quota|within quota|over quota)\b/.test(text)) return 'quota';
    if (/\b(note|see\s+(subheading\s+)?note)\b/.test(text)) {
      return 'note_reference';
    }
    if (/\b(not less than|not over|minimum|maximum)\b/.test(text)) {
      return 'min_max_constraint';
    }
    if (/\d+(?:\.\d+)?\s*(?:-|to)\s*\d+(?:\.\d+)?\s*%/.test(text)) {
      return 'range';
    }
    if (/%/.test(text) && /\b(per|\/)\b/.test(text)) return 'compound';
    if (/%/.test(text)) return 'ad_valorem';
    if (/\bkg\b|kilogram|pound|lb\b/.test(text)) return 'specific_weight';
    if (/\bliter\b|litre|proof liter/.test(text)) return 'specific_volume';
    if (/\bm2\b|square meter|square metre/.test(text)) return 'specific_area';
    if (/\bm\b|meter|metre/.test(text)) return 'specific_length';
    if (/\beach\b|dozen|pair|gross|piece|pcs/.test(text)) {
      return 'specific_quantity';
    }
    return 'other';
  }

  private unitDimensionTags(value: unknown): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return ['missing_unit_dimensions'];
    }
    const dimensions = Object.values(value as Record<string, unknown>)
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.toLowerCase());
    return dimensions.length > 0
      ? Array.from(new Set(dimensions)).sort()
      : ['empty_unit_dimensions'];
  }

  private conditionKind(value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return 'missing_condition_ast';
    }
    const kind = (value as Record<string, unknown>).kind;
    return typeof kind === 'string' && kind ? kind : 'unknown_condition_kind';
  }

  private weightedAverage(
    rows: Array<Record<string, unknown>>,
    valueKey: string,
    weightKey: string,
  ): number | null {
    let weighted = 0;
    let weightTotal = 0;
    for (const row of rows) {
      const value = this.optionalNumber(row[valueKey]);
      const weight = this.number(row[weightKey]);
      if (value === null || weight <= 0) {
        continue;
      }
      weighted += value * weight;
      weightTotal += weight;
    }
    return weightTotal > 0 ? this.round(weighted / weightTotal, 4) : null;
  }

  private ratio(numerator: number, denominator: number): number {
    return denominator > 0 ? this.round(numerator / denominator, 4) : 0;
  }

  private optionalNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? this.round(parsed, 4) : null;
  }

  private number(value: unknown, fallback = 0): number {
    if (value === null || value === undefined) {
      return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private round(value: number, places: number): number {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  }

  private subtractDays(date: Date, days: number): Date {
    return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
  }

  private dateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
