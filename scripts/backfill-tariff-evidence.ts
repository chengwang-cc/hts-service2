#!/usr/bin/env ts-node

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HtsEntity, HtsExtraTaxEntity } from '../src/core/entities';
import {
  FormulaSemanticsService,
  TariffEvidenceEntity,
  TariffKnowledgeCardEntity,
  validateFormulaArtifacts,
} from '../src/modules/calculator';
import { TariffSourceEntity } from '../src/modules/jurisdiction/entities';

type BackfillEvidenceInput = {
  htsNumber: string;
  countryCode: string;
  destinationCode: string;
  rateClass: string;
  componentType: string;
  calculationStage: string;
  sourceId: string | null;
  citationUrl: string | null;
  citationQuote: string | null;
  rateText: string | null;
  formulaText: string | null;
  sourceEffectiveFrom: string | null;
  parserName: string;
  parserVersion: string;
  parserConfidence: number;
  metadata: Record<string, any>;
};

async function main() {
  const dry =
    process.argv.includes('--dry') || process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const htsRepo = app.get<Repository<HtsEntity>>(
      getRepositoryToken(HtsEntity),
    );
    const extraTaxRepo = app.get<Repository<HtsExtraTaxEntity>>(
      getRepositoryToken(HtsExtraTaxEntity),
    );
    const sourceRepo = app.get<Repository<TariffSourceEntity>>(
      getRepositoryToken(TariffSourceEntity),
    );
    const evidenceRepo = app.get<Repository<TariffEvidenceEntity>>(
      getRepositoryToken(TariffEvidenceEntity),
    );
    const cardRepo = app.get<Repository<TariffKnowledgeCardEntity>>(
      getRepositoryToken(TariffKnowledgeCardEntity),
    );
    const semantics = app.get(FormulaSemanticsService);

    const usitcSource = await sourceRepo.findOne({
      where: { jurisdictionCode: 'US', sourceName: 'USITC HTS JSON' },
    });
    const aiStagingSource = await sourceRepo.findOne({
      where: { jurisdictionCode: 'US', sourceName: 'AI Service Staging' },
    });

    let scannedHts = 0;
    let scannedExtraTax = 0;
    let insertedEvidence = 0;
    let insertedCards = 0;

    const htsRows = await htsRepo.find({ where: { isActive: true } });
    for (const hts of htsRows) {
      scannedHts++;
      const sourceEffectiveFrom =
        hts.effectiveDate instanceof Date
          ? hts.effectiveDate.toISOString().slice(0, 10)
          : null;
      const evidenceInputs: BackfillEvidenceInput[] = [];

      if (hts.rateFormula) {
        evidenceInputs.push({
          htsNumber: hts.htsNumber,
          countryCode: 'ALL',
          destinationCode: 'US',
          rateClass: 'base',
          componentType: 'base',
          calculationStage: 'base',
          sourceId: usitcSource?.id || null,
          citationUrl: usitcSource?.sourceUrl || null,
          citationQuote: hts.generalRate || hts.general || null,
          rateText: hts.generalRate || hts.general || null,
          formulaText: hts.rateFormula,
          sourceEffectiveFrom,
          parserName: 'legacy-hts-backfill',
          parserVersion: 'phase-2-initial',
          parserConfidence: 0.95,
          metadata: {
            backfillSource: 'hts.rateFormula',
            sourceVersion: hts.sourceVersion || hts.version || null,
          },
        });
      }

      if (hts.otherRateFormula) {
        evidenceInputs.push({
          htsNumber: hts.htsNumber,
          countryCode: 'ALL',
          destinationCode: 'US',
          rateClass: 'non_ntr',
          componentType: 'non_ntr',
          calculationStage: 'base',
          sourceId: usitcSource?.id || null,
          citationUrl: usitcSource?.sourceUrl || null,
          citationQuote: hts.otherRate || hts.other || null,
          rateText: hts.otherRate || hts.other || null,
          formulaText: hts.otherRateFormula,
          sourceEffectiveFrom,
          parserName: 'legacy-hts-backfill',
          parserVersion: 'phase-2-initial',
          parserConfidence: 0.95,
          metadata: {
            backfillSource: 'hts.otherRateFormula',
            sourceVersion: hts.sourceVersion || hts.version || null,
          },
        });
      }

      if (hts.adjustedFormula) {
        const countries = hts.chapter99ApplicableCountries?.length
          ? hts.chapter99ApplicableCountries
          : ['ALL'];
        for (const countryCode of countries) {
          evidenceInputs.push({
            htsNumber: hts.htsNumber,
            countryCode: countryCode.toUpperCase(),
            destinationCode: 'US',
            rateClass: 'chapter_99',
            componentType: 'chapter_99',
            calculationStage: 'additional_duty',
            sourceId: usitcSource?.id || null,
            citationUrl: usitcSource?.sourceUrl || null,
            citationQuote: hts.chapter99 || null,
            rateText: hts.chapter99 || null,
            formulaText: hts.adjustedFormula,
            sourceEffectiveFrom,
            parserName: 'legacy-hts-backfill',
            parserVersion: 'phase-2-initial',
            parserConfidence: 0.8,
            metadata: {
              backfillSource: 'hts.adjustedFormula',
              sourceVersion: hts.sourceVersion || hts.version || null,
              chapter99Synthesis: hts.metadata?.chapter99Synthesis || null,
            },
          });
        }
      }

      for (const input of evidenceInputs) {
        const inserted = await insertEvidenceAndCard({
          input,
          evidenceRepo,
          cardRepo,
          semantics,
          dry,
        });
        insertedEvidence += inserted.evidence;
        insertedCards += inserted.card;
      }
    }

    const extraTaxes = await extraTaxRepo.find({ where: { isActive: true } });
    for (const tax of extraTaxes) {
      scannedExtraTax++;
      if (!tax.rateFormula) continue;
      const formulaText = normalizeFormulaAliases(tax.rateFormula);
      const htsNumber =
        tax.htsNumber && tax.htsNumber !== '*'
          ? tax.htsNumber
          : tax.htsChapter
            ? `${tax.htsChapter}.*`
            : '*';
      const input: BackfillEvidenceInput = {
        htsNumber,
        countryCode: (tax.countryCode || 'ALL').toUpperCase(),
        destinationCode: 'US',
        rateClass: classifyRateClass(tax.taxCode, tax.extraRateType),
        componentType: classifyComponentType(tax.taxCode, tax.extraRateType),
        calculationStage:
          tax.extraRateType === 'POST_CALCULATION'
            ? 'post_calculation_fee'
            : 'additional_duty',
        sourceId: aiStagingSource?.id || usitcSource?.id || null,
        citationUrl: null,
        citationQuote: tax.legalReference || tax.rateText || null,
        rateText: tax.rateText || null,
        formulaText,
        sourceEffectiveFrom:
          tax.effectiveDate instanceof Date
            ? tax.effectiveDate.toISOString().slice(0, 10)
            : null,
        parserName: 'legacy-extra-tax-backfill',
        parserVersion: 'phase-2-initial',
        parserConfidence: 0.7,
        metadata: {
          backfillSource: 'hts_extra_taxes',
          taxCode: tax.taxCode,
          conditions: tax.conditions || null,
        },
      };

      const inserted = await insertEvidenceAndCard({
        input,
        evidenceRepo,
        cardRepo,
        semantics,
        dry,
      });
      insertedEvidence += inserted.evidence;
      insertedCards += inserted.card;
    }

    process.stdout.write(
      `\nbackfill-tariff-evidence ${dry ? '(DRY) ' : ''}done: ` +
        `hts=${scannedHts} extraTaxes=${scannedExtraTax} ` +
        `evidenceInserted=${insertedEvidence} cardsInserted=${insertedCards}\n`,
    );
  } finally {
    await app.close();
  }
}

async function insertEvidenceAndCard(args: {
  input: BackfillEvidenceInput;
  evidenceRepo: Repository<TariffEvidenceEntity>;
  cardRepo: Repository<TariffKnowledgeCardEntity>;
  semantics: FormulaSemanticsService;
  dry: boolean;
}): Promise<{ evidence: number; card: number }> {
  const { input, evidenceRepo, cardRepo, semantics, dry } = args;
  const analyzed = input.formulaText
    ? semantics.analyze(input.formulaText)
    : null;
  const semanticHash = analyzed?.semanticHash || null;
  const effectiveFrom = input.sourceEffectiveFrom || '1970-01-01';
  const conditionAst = input.metadata.conditions || { kind: 'always' };
  const unitDimensions = {};
  const constraints = {};
  const roundingPolicy = { mode: 'component_2dp' };
  const artifactValidation = validateFormulaArtifacts(
    {
      formulaText: input.formulaText,
      formulaAst: analyzed?.formulaAst || null,
      conditionAst,
      unitDimensions,
      constraints,
      roundingPolicy,
    },
    { requireRuntimeArtifacts: !!input.formulaText },
  );
  const validationErrors = [
    ...(analyzed?.validationErrors || []),
    ...artifactValidation.errors,
  ];
  const validationStatus =
    validationErrors.length > 0 ? 'needs_review' : 'valid';
  const evidenceStatus = validationStatus === 'valid' ? 'accepted' : 'pending';

  const evidenceQuery = evidenceRepo
    .createQueryBuilder('evidence')
    .where('evidence.htsNumber = :htsNumber', { htsNumber: input.htsNumber })
    .andWhere('evidence.countryCode = :countryCode', {
      countryCode: input.countryCode,
    })
    .andWhere('evidence.destinationCode = :destinationCode', {
      destinationCode: input.destinationCode,
    })
    .andWhere('evidence.rateClass = :rateClass', {
      rateClass: input.rateClass,
    })
    .andWhere('evidence.componentType = :componentType', {
      componentType: input.componentType,
    });
  if (semanticHash) {
    evidenceQuery.andWhere('evidence.formulaSemanticHash = :semanticHash', {
      semanticHash,
    });
  } else {
    evidenceQuery.andWhere('evidence.formulaSemanticHash IS NULL');
  }
  if (input.sourceId) {
    evidenceQuery.andWhere('evidence.sourceId = :sourceId', {
      sourceId: input.sourceId,
    });
  } else {
    evidenceQuery.andWhere('evidence.sourceId IS NULL');
  }
  const existingEvidence = await evidenceQuery.getOne();

  let evidenceInserted = 0;
  if (!existingEvidence) {
    evidenceInserted = 1;
    if (!dry) {
      await evidenceRepo.save(
        evidenceRepo.create({
          ...input,
          formulaAst: analyzed?.formulaAst || null,
          formulaCanonical: analyzed?.canonicalFormula || null,
          formulaSemanticHash: semanticHash,
          conditionAst,
          unitDimensions,
          constraints,
          roundingPolicy,
          validationStatus,
          validationErrors:
            validationErrors.length > 0 ? validationErrors : null,
          testVectors: null,
          reviewerConfidence: null,
          reviewer: null,
          reviewedAt: null,
          status: evidenceStatus,
          supersededBy: null,
          citationSnapshotUri: null,
          sourceEffectiveTo: null,
          compiledFormula: input.formulaText,
          aiModel: null,
          aiPromptVersion: null,
          metadata: {
            ...(input.metadata || {}),
            artifactValidatorVersion: artifactValidation.validatorVersion,
            artifactValidationErrors: artifactValidation.errors,
          },
        }),
      );
    }
  }

  const existingCard = await cardRepo.findOne({
    where: {
      htsNumber: input.htsNumber,
      countryCode: input.countryCode,
      destinationCode: input.destinationCode,
      rateClass: input.rateClass,
      componentType: input.componentType,
      effectiveFrom,
    },
  });

  let cardInserted = 0;
  if (!existingCard && validationStatus === 'valid') {
    cardInserted = 1;
    if (!dry) {
      await cardRepo.save(
        cardRepo.create({
          htsNumber: input.htsNumber,
          countryCode: input.countryCode,
          destinationCode: input.destinationCode,
          rateClass: input.rateClass,
          componentType: input.componentType,
          effectiveFrom,
          effectiveTo: null,
          consensusFormula: input.formulaText,
          consensusFormulaAst: analyzed?.formulaAst || null,
          consensusConditionAst: conditionAst,
          consensusConstraints: constraints,
          consensusRoundingPolicy: roundingPolicy,
          consensusSemanticHash: semanticHash,
          agreementScore: 1,
          confidenceScore: input.parserConfidence,
          evidenceCount: 1,
          disagreementCount: 0,
          openQuestions: null,
          status: 'authoritative',
          lastReviewedAt: null,
          reviewer: null,
          metadata: {
            backfill: true,
            parserName: input.parserName,
            parserVersion: input.parserVersion,
            artifactValidatorVersion: artifactValidation.validatorVersion,
            artifactValidationErrors: artifactValidation.errors,
          },
        }),
      );
    }
  }

  return { evidence: evidenceInserted, card: cardInserted };
}

function classifyRateClass(taxCode: string, extraRateType: string): string {
  const code = (taxCode || '').toUpperCase();
  if (code.includes('SECTION_301')) return 'section_301';
  if (code.includes('SECTION_232')) return 'section_232';
  if (code.includes('SECTION_122')) return 'section_122';
  if (code.startsWith('MPF')) return 'mpf';
  if (code.startsWith('HMF')) return 'hmf';
  if (extraRateType === 'POST_CALCULATION') return 'post_tax';
  return 'additional_duty';
}

function classifyComponentType(taxCode: string, extraRateType: string): string {
  const rateClass = classifyRateClass(taxCode, extraRateType);
  if (rateClass === 'additional_duty') {
    return 'chapter_99';
  }
  return rateClass;
}

function normalizeFormulaAliases(formula: string): string {
  return formula.replace(/\bpf_liter\b/g, 'proof_liter');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('backfill-tariff-evidence failed:', err?.stack || err);
  process.exit(1);
});
