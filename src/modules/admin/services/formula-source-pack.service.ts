import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsEntity } from '../../../core/entities/hts.entity';
import { HtsStageEntryEntity } from '../../../core/entities/hts-stage-entry.entity';
import { TariffEvidenceEntity } from '../../calculator/entities/tariff-evidence.entity';
import { TariffKnowledgeCardEntity } from '../../calculator/entities/tariff-knowledge-card.entity';
import {
  FormulaSourcePack,
  FormulaSourcePackSchema,
  JsonRecord,
} from './formula-ai-validation.schemas';
import {
  sha256Hex,
  stableStringify,
  toJsonRecord,
  toJsonValue,
} from './formula-ai-validation.util';

export interface BuildFormulaSourcePackInput {
  htsNumber: string;
  sourceVersion?: string;
  originCountry?: string;
  destinationCountry?: string;
  effectiveDate?: string;
  includeEvidence?: boolean;
}

@Injectable()
export class FormulaSourcePackService {
  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepo: Repository<HtsEntity>,
    @InjectRepository(HtsStageEntryEntity)
    private readonly stageRepo: Repository<HtsStageEntryEntity>,
    @InjectRepository(TariffEvidenceEntity)
    private readonly evidenceRepo: Repository<TariffEvidenceEntity>,
    @InjectRepository(TariffKnowledgeCardEntity)
    private readonly cardRepo: Repository<TariffKnowledgeCardEntity>,
  ) {}

  async build(input: BuildFormulaSourcePackInput): Promise<FormulaSourcePack> {
    const htsNumber = input.htsNumber.trim();
    const originCountry = (input.originCountry || 'ALL').toUpperCase();
    const destinationCountry = (input.destinationCountry || 'US').toUpperCase();
    const staged = await this.findStagedEntry(htsNumber, input.sourceVersion);
    const active = await this.findActiveEntry(htsNumber, input.sourceVersion);

    if (!staged && !active) {
      throw new NotFoundException(`HTS row not found: ${htsNumber}`);
    }

    const sourceVersion =
      input.sourceVersion ||
      staged?.sourceVersion ||
      active?.sourceVersion ||
      active?.version ||
      'unknown';
    const includeEvidence = input.includeEvidence !== false;
    const [knownCards, knownEvidence] = includeEvidence
      ? await Promise.all([
          this.loadCards(htsNumber, originCountry, destinationCountry),
          this.loadEvidence(htsNumber, originCountry, destinationCountry),
        ])
      : [[], []];

    const chapter99Candidates = this.buildChapter99Candidates(active);
    const sourceWithoutId = {
      htsNumber,
      sourceVersion,
      effectiveDate:
        input.effectiveDate || this.formatDate(active?.effectiveDate) || null,
      destinationCountry,
      originCountry,
      articleDescription: staged?.description || active?.description || null,
      unit: staged?.unit || active?.unit || active?.unitOfQuantity || null,
      rateText:
        staged?.generalRate || active?.generalRate || active?.general || null,
      specialRateText: staged?.special || active?.special || null,
      otherRateText:
        staged?.other || active?.otherRate || active?.other || null,
      chapter99Text: staged?.chapter99 || active?.chapter99 || null,
      chapterNotes: [],
      sectionNotes: [],
      generalNotes: [],
      chapter99Candidates,
      currentFormulaArtifact: this.buildCurrentFormulaArtifact(active),
      knownParserOutput: this.buildKnownParserOutput(active, staged),
      knownBrokerCases: [],
      knownProviderQuotes: [],
      knownEvidence,
      knownCards,
      requiredOutputSchemaVersion: 'formula-artifact-v1' as const,
      metadata: {
        source: 'formula-source-pack-service',
        activeHtsId: active?.id || null,
        stagedEntryId: staged?.id || null,
        importId: staged?.importId || null,
        chapter99ProgramFamilies:
          this.chapter99ProgramFamilies(chapter99Candidates),
        generatedAt: new Date().toISOString(),
      },
    };
    const sourcePackId = sha256Hex(stableStringify(sourceWithoutId));
    return FormulaSourcePackSchema.parse({
      sourcePackId,
      ...sourceWithoutId,
    });
  }

  private findStagedEntry(
    htsNumber: string,
    sourceVersion?: string,
  ): Promise<HtsStageEntryEntity | null> {
    const qb = this.stageRepo
      .createQueryBuilder('stage')
      .where('stage.htsNumber = :htsNumber', { htsNumber });
    if (sourceVersion) {
      qb.andWhere('stage.sourceVersion = :sourceVersion', { sourceVersion });
    }
    return qb
      .orderBy('stage.createdAt', 'DESC')
      .addOrderBy('stage.sourceVersion', 'DESC')
      .getOne();
  }

  private findActiveEntry(
    htsNumber: string,
    sourceVersion?: string,
  ): Promise<HtsEntity | null> {
    const qb = this.htsRepo
      .createQueryBuilder('hts')
      .where('hts.htsNumber = :htsNumber', { htsNumber });
    if (sourceVersion) {
      qb.andWhere(
        '(hts.sourceVersion = :sourceVersion OR hts.version = :sourceVersion)',
        { sourceVersion },
      );
    } else {
      qb.andWhere('hts.isActive = :isActive', { isActive: true });
    }
    return qb
      .orderBy('hts.isActive', 'DESC')
      .addOrderBy('hts.importDate', 'DESC', 'NULLS LAST')
      .addOrderBy('hts.updatedAt', 'DESC')
      .getOne();
  }

  private async loadCards(
    htsNumber: string,
    originCountry: string,
    destinationCountry: string,
  ): Promise<JsonRecord[]> {
    const cards = await this.cardRepo
      .createQueryBuilder('card')
      .where('card.htsNumber = :htsNumber', { htsNumber })
      .andWhere('card.destinationCode = :destinationCountry', {
        destinationCountry,
      })
      .andWhere(
        '(card.countryCode = :originCountry OR card.countryCode = :all)',
        {
          originCountry,
          all: 'ALL',
        },
      )
      .orderBy('card.status', 'ASC')
      .addOrderBy('card.lastReviewedAt', 'DESC', 'NULLS LAST')
      .limit(20)
      .getMany();
    return cards.map((card) =>
      toJsonRecord({
        id: card.id,
        countryCode: card.countryCode,
        destinationCode: card.destinationCode,
        rateClass: card.rateClass,
        componentType: card.componentType,
        effectiveFrom: card.effectiveFrom,
        effectiveTo: card.effectiveTo,
        consensusFormula: card.consensusFormula,
        consensusFormulaAst: card.consensusFormulaAst,
        consensusConditionAst: card.consensusConditionAst,
        consensusConstraints: card.consensusConstraints,
        consensusRoundingPolicy: card.consensusRoundingPolicy,
        consensusSemanticHash: card.consensusSemanticHash,
        agreementScore: Number(card.agreementScore),
        confidenceScore: Number(card.confidenceScore),
        evidenceCount: card.evidenceCount,
        disagreementCount: card.disagreementCount,
        status: card.status,
      }),
    );
  }

  private async loadEvidence(
    htsNumber: string,
    originCountry: string,
    destinationCountry: string,
  ): Promise<JsonRecord[]> {
    const evidence = await this.evidenceRepo
      .createQueryBuilder('evidence')
      .where('evidence.htsNumber = :htsNumber', { htsNumber })
      .andWhere('evidence.destinationCode = :destinationCountry', {
        destinationCountry,
      })
      .andWhere(
        '(evidence.countryCode = :originCountry OR evidence.countryCode = :all)',
        {
          originCountry,
          all: 'ALL',
        },
      )
      .orderBy('evidence.status', 'ASC')
      .addOrderBy('evidence.retrievedAt', 'DESC')
      .limit(20)
      .getMany();
    return evidence.map((item) =>
      toJsonRecord({
        id: item.id,
        countryCode: item.countryCode,
        destinationCode: item.destinationCode,
        rateClass: item.rateClass,
        componentType: item.componentType,
        calculationStage: item.calculationStage,
        citationUrl: item.citationUrl,
        citationQuote: item.citationQuote,
        sourceEffectiveFrom: item.sourceEffectiveFrom,
        sourceEffectiveTo: item.sourceEffectiveTo,
        rateText: item.rateText,
        formulaText: item.formulaText,
        formulaCanonical: item.formulaCanonical,
        formulaSemanticHash: item.formulaSemanticHash,
        conditionAst: item.conditionAst,
        unitDimensions: item.unitDimensions,
        constraints: item.constraints,
        roundingPolicy: item.roundingPolicy,
        validationStatus: item.validationStatus,
        validationErrors: item.validationErrors,
        status: item.status,
      }),
    );
  }

  private buildChapter99Candidates(active: HtsEntity | null): JsonRecord[] {
    if (!active) {
      return [];
    }
    const links = active.chapter99Links || [];
    const candidates = links.map((htsNumber) =>
      toJsonRecord({
        htsNumber,
        source: 'active-hts.chapter99Links',
        countries: active.chapter99ApplicableCountries || [],
        ...this.classifyChapter99Program({
          htsNumber,
          context: [active.chapter99, active.adjustedFormula],
        }),
      }),
    );
    const activeChapter99Heading = this.extractChapter99Heading(
      active.htsNumber,
    );
    if (activeChapter99Heading) {
      candidates.push(
        toJsonRecord({
          htsNumber: active.htsNumber,
          source: 'active-hts.self',
          rateText: active.generalRate || active.general || active.chapter99,
          formulaText: active.rateFormula || active.adjustedFormula,
          countries: active.chapter99ApplicableCountries || [],
          ...this.classifyChapter99Program({
            htsNumber: active.htsNumber,
            context: [
              active.description,
              active.generalRate,
              active.general,
              active.chapter99,
              active.rateFormula,
              active.adjustedFormula,
            ],
          }),
        }),
      );
    }
    if (active.chapter99 || active.adjustedFormula) {
      const chapter99RateHeading =
        links.length === 1 ? links[0] : active.htsNumber;
      candidates.push(
        toJsonRecord({
          htsNumber: active.htsNumber,
          source: 'active-hts.chapter99',
          rateText: active.chapter99,
          formulaText: active.adjustedFormula,
          countries: active.chapter99ApplicableCountries || [],
          ...this.classifyChapter99Program({
            htsNumber: chapter99RateHeading,
            context: [active.chapter99, active.adjustedFormula, links],
          }),
        }),
      );
    }
    if (active.otherChapter99Detail) {
      candidates.push(
        toJsonRecord({
          htsNumber: active.htsNumber,
          source: 'active-hts.otherChapter99Detail',
          detail: active.otherChapter99Detail,
          ...this.classifyChapter99Program({
            htsNumber: active.htsNumber,
            context: [active.otherChapter99Detail],
          }),
        }),
      );
    }
    return candidates;
  }

  private classifyChapter99Program(input: {
    htsNumber: string | null;
    context: unknown[];
  }): Record<string, string | string[] | boolean | null> {
    const heading = this.extractChapter99Heading(input.htsNumber);
    const searchText = [
      heading,
      input.htsNumber,
      ...input.context.map((item) => this.searchText(item)),
    ]
      .filter((value): value is string => !!value)
      .join(' ')
      .toUpperCase();
    const bases: string[] = [];
    if (heading) {
      bases.push(`heading:${heading}`);
    }
    const explicitSection = searchText.match(/SECTION[_\s-]*(\d{3})\b/);
    if (explicitSection) {
      const section = explicitSection[1];
      bases.push(`section_${section}_text`);
      return this.chapter99ProgramResult({
        heading,
        programFamily: `section_${section}`,
        programAuthority: `Section ${section}`,
        bases,
      });
    }
    const headingRule = this.classifyChapter99Heading(heading);
    if (headingRule) {
      bases.push(headingRule.basis);
      return this.chapter99ProgramResult({
        heading,
        programFamily: headingRule.programFamily,
        programAuthority: headingRule.programAuthority,
        bases,
      });
    }
    const textRule = this.classifyChapter99Text(searchText);
    if (textRule) {
      bases.push(textRule.basis);
      return this.chapter99ProgramResult({
        heading,
        programFamily: textRule.programFamily,
        programAuthority: textRule.programAuthority,
        bases,
      });
    }
    const isChapter99 =
      !!heading || /CHAPTER\s*99|CH99|9903\./.test(searchText);
    return {
      isChapter99,
      chapter99Heading: heading,
      programFamily: isChapter99 ? 'chapter_99' : null,
      programBasis: bases,
    };
  }

  private classifyChapter99Heading(
    heading: string | null,
  ): { programFamily: string; programAuthority: string; basis: string } | null {
    if (!heading) {
      return null;
    }
    const headingRules: Array<{
      pattern: RegExp;
      programFamily: string;
      programAuthority: string;
      basis: string;
    }> = [
      {
        pattern: /^9903\.(88|91|92)\./,
        programFamily: 'section_301',
        programAuthority: 'Section 301',
        basis: 'section_301_heading_pattern',
      },
      {
        pattern: /^9903\.(74|76|78|79|80|81|85|94)\./,
        programFamily: 'section_232',
        programAuthority: 'Section 232',
        basis: 'section_232_heading_pattern',
      },
      {
        pattern: /^9903\.45\./,
        programFamily: 'section_201',
        programAuthority: 'Section 201',
        basis: 'section_201_heading_pattern',
      },
      {
        pattern: /^9903\.40\./,
        programFamily: 'section_421',
        programAuthority: 'Section 421',
        basis: 'section_421_heading_pattern',
      },
      {
        pattern: /^9903\.01\./,
        programFamily: 'reciprocal_ieepa',
        programAuthority: 'IEEPA / reciprocal tariff',
        basis: 'reciprocal_ieepa_heading_pattern',
      },
      {
        pattern: /^9903\.(17|18|52|54|55)\./,
        programFamily: 'quota',
        programAuthority: 'quota',
        basis: 'quota_heading_pattern',
      },
      {
        pattern: /^9902\./,
        programFamily: 'temporary_duty_suspension',
        programAuthority: 'temporary duty suspension',
        basis: 'temporary_duty_suspension_heading_pattern',
      },
    ];
    return headingRules.find((rule) => rule.pattern.test(heading)) || null;
  }

  private classifyChapter99Text(
    searchText: string,
  ): { programFamily: string; programAuthority: string; basis: string } | null {
    const textRules: Array<{
      pattern: RegExp;
      programFamily: string;
      programAuthority: string;
      basis: string;
    }> = [
      {
        pattern: /RECIPROCAL|IEEPA|EMERGENCY\s+ECONOMIC\s+POWERS/,
        programFamily: 'reciprocal_ieepa',
        programAuthority: 'IEEPA / reciprocal tariff',
        basis: 'reciprocal_ieepa_text_pattern',
      },
      {
        pattern: /SAFEGUARD/,
        programFamily: 'safeguard',
        programAuthority: 'safeguard',
        basis: 'safeguard_text_pattern',
      },
      {
        pattern: /QUOTA/,
        programFamily: 'quota',
        programAuthority: 'quota',
        basis: 'quota_text_pattern',
      },
      {
        pattern: /RETALIATION|RETALIATORY/,
        programFamily: 'retaliatory_tariff',
        programAuthority: 'retaliatory tariff',
        basis: 'retaliatory_text_pattern',
      },
    ];
    return textRules.find((rule) => rule.pattern.test(searchText)) || null;
  }

  private chapter99ProgramResult(input: {
    heading: string | null;
    programFamily: string;
    programAuthority: string;
    bases: string[];
  }): Record<string, string | string[] | boolean | null> {
    return {
      isChapter99: true,
      chapter99Heading: input.heading,
      programFamily: input.programFamily,
      programAuthority: input.programAuthority,
      programBasis: input.bases,
    };
  }

  private chapter99ProgramFamilies(candidates: JsonRecord[]): string[] {
    return Array.from(
      new Set(
        candidates
          .map((candidate) => candidate.programFamily)
          .filter((value): value is string => typeof value === 'string'),
      ),
    );
  }

  private extractChapter99Heading(
    value: string | null | undefined,
  ): string | null {
    if (!value) {
      return null;
    }
    const match = value.match(/\b99\d{2}\.\d{2}(?:\.\d{2})?(?:\.\d{2})?\b/);
    return match?.[0] || null;
  }

  private searchText(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      Array.isArray(value) ||
      typeof value === 'object'
    ) {
      return stableStringify(toJsonValue(value));
    }
    return null;
  }

  private buildCurrentFormulaArtifact(active: HtsEntity | null): JsonRecord {
    if (!active) {
      return {};
    }
    return toJsonRecord({
      general: {
        rateText: active.generalRate || active.general,
        formulaText: active.rateFormula,
        variables: active.rateVariables,
        isGenerated: active.isFormulaGenerated,
      },
      special: {
        rateText: active.special,
        specialRates: active.specialRates,
      },
      other: {
        rateText: active.otherRate || active.other,
        formulaText: active.otherRateFormula,
        variables: active.otherRateVariables,
        isGenerated: active.isOtherFormulaGenerated,
      },
      chapter99: {
        rateText: active.chapter99,
        formulaText: active.adjustedFormula,
        variables: active.adjustedFormulaVariables,
        isGenerated: active.isAdjustedFormulaGenerated,
      },
      metadata: active.metadata,
    });
  }

  private buildKnownParserOutput(
    active: HtsEntity | null,
    staged: HtsStageEntryEntity | null,
  ): JsonRecord {
    return toJsonRecord({
      active: active
        ? {
            rateTextHash: active.rateTextHash,
            formulaConfidence:
              active.formulaConfidence === null ||
              active.formulaConfidence === undefined
                ? null
                : Number(active.formulaConfidence),
            formulaGeneratedAt: this.formatDate(active.formulaGeneratedAt),
            requiredReview: active.requiredReview,
            requiredReviewComment: active.requiredReviewComment,
            updateFormulaComment: active.updateFormulaComment,
          }
        : null,
      staged: staged
        ? {
            rowHash: staged.rowHash,
            rawItem: toJsonValue(staged.rawItem),
            normalized: toJsonValue(staged.normalized),
          }
        : null,
    });
  }

  private formatDate(value: Date | string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    return value;
  }
}
