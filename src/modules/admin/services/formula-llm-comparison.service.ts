import { Inject, Injectable } from '@nestjs/common';
import { FormulaSemanticsService } from '../../calculator/services/formula-semantics.service';
import type { EvidenceReconciliationPacketEntity } from '../entities/evidence-reconciliation-packet.entity';
import {
  FormulaComponentArtifact,
  FormulaExtractorOutput,
  FormulaSourcePack,
  JsonRecord,
} from './formula-ai-validation.schemas';
import { stableStringify, toJsonRecord } from './formula-ai-validation.util';

export const FORMULA_EVIDENCE_RECONCILIATION_GATEWAY = Symbol(
  'FORMULA_EVIDENCE_RECONCILIATION_GATEWAY',
);

interface FormulaEvidenceReconciliationGateway {
  createPacketForScope(options: {
    htsNumber: string;
    countryCode: string;
    destinationCode?: string;
    rateClass?: string;
    componentType?: string;
    reason: string;
    metadata?: JsonRecord | null;
  }): Promise<EvidenceReconciliationPacketEntity | null>;
}

export type FormulaLlmAgreementStatus =
  | 'matched'
  | 'equivalent'
  | 'different'
  | 'both_invalid'
  | 'one_invalid'
  | 'unsupported';

export interface FormulaLlmDifference {
  field: string;
  codexValue: unknown;
  qwenValue: unknown;
  severity: 'P1' | 'P2' | 'P3';
  reason: string;
}

export interface FormulaLlmComparisonResult {
  agreementStatus: FormulaLlmAgreementStatus;
  differences: FormulaLlmDifference[];
  requiresClaudeJudge: boolean;
  requiresHumanReview: boolean;
  selectedArtifact: FormulaExtractorOutput | null;
  codexSemanticHashes: string[];
  qwenSemanticHashes: string[];
  highRiskReasons: string[];
}

@Injectable()
export class FormulaLlmComparisonService {
  constructor(
    private readonly semantics: FormulaSemanticsService,
    @Inject(FORMULA_EVIDENCE_RECONCILIATION_GATEWAY)
    private readonly reconciliation: FormulaEvidenceReconciliationGateway,
  ) {}

  compare(args: {
    sourcePack: FormulaSourcePack;
    codexOutput: FormulaExtractorOutput | null;
    qwenOutput: FormulaExtractorOutput | null;
    codexErrors?: string[];
    qwenErrors?: string[];
  }): FormulaLlmComparisonResult {
    const highRiskReasons = this.highRiskReasons(args.sourcePack);
    if (!args.codexOutput && !args.qwenOutput) {
      return {
        agreementStatus: 'both_invalid',
        differences: [
          {
            field: 'outputs',
            codexValue: args.codexErrors || null,
            qwenValue: args.qwenErrors || null,
            severity: 'P1',
            reason: 'Both extractor outputs are invalid or unavailable',
          },
        ],
        requiresClaudeJudge: true,
        requiresHumanReview: true,
        selectedArtifact: null,
        codexSemanticHashes: [],
        qwenSemanticHashes: [],
        highRiskReasons,
      };
    }
    if (!args.codexOutput || !args.qwenOutput) {
      return {
        agreementStatus: 'one_invalid',
        differences: [
          {
            field: 'outputs',
            codexValue: args.codexOutput ? 'valid' : args.codexErrors || null,
            qwenValue: args.qwenOutput ? 'valid' : args.qwenErrors || null,
            severity: 'P1',
            reason: 'Only one extractor produced a valid artifact',
          },
        ],
        requiresClaudeJudge: true,
        requiresHumanReview: true,
        selectedArtifact: args.codexOutput || args.qwenOutput,
        codexSemanticHashes: this.semanticHashes(args.codexOutput),
        qwenSemanticHashes: this.semanticHashes(args.qwenOutput),
        highRiskReasons,
      };
    }

    const codexUnsupported = this.unsupportedVerdictReasons(args.codexOutput);
    const qwenUnsupported = this.unsupportedVerdictReasons(args.qwenOutput);
    if (codexUnsupported.length > 0 || qwenUnsupported.length > 0) {
      return {
        agreementStatus: 'unsupported',
        differences: [
          {
            field: 'verdict',
            codexValue: args.codexOutput.verdict,
            qwenValue: args.qwenOutput.verdict,
            severity: 'P1',
            reason: [...codexUnsupported, ...qwenUnsupported].join('; '),
          },
        ],
        requiresClaudeJudge: true,
        requiresHumanReview: true,
        selectedArtifact: null,
        codexSemanticHashes: this.semanticHashes(args.codexOutput),
        qwenSemanticHashes: this.semanticHashes(args.qwenOutput),
        highRiskReasons,
      };
    }

    const differences = this.diffArtifacts(args.codexOutput, args.qwenOutput);
    const codexSemanticHashes = this.semanticHashes(args.codexOutput);
    const qwenSemanticHashes = this.semanticHashes(args.qwenOutput);
    const requiresHumanReview =
      highRiskReasons.length > 0 ||
      args.codexOutput.needsJudge ||
      args.qwenOutput.needsJudge;
    const hasMaterialDifferences = differences.some(
      (difference) => difference.severity !== 'P3',
    );
    const status =
      differences.length === 0
        ? 'matched'
        : !hasMaterialDifferences &&
            stableStringify(codexSemanticHashes) ===
              stableStringify(qwenSemanticHashes)
          ? 'equivalent'
          : 'different';

    return {
      agreementStatus: status,
      differences,
      requiresClaudeJudge: status === 'different' || requiresHumanReview,
      requiresHumanReview: requiresHumanReview || status !== 'matched',
      selectedArtifact:
        status === 'matched' || status === 'equivalent'
          ? args.codexOutput
          : null,
      codexSemanticHashes,
      qwenSemanticHashes,
      highRiskReasons,
    };
  }

  parserDisagreesWithSelected(
    sourcePack: FormulaSourcePack,
    selectedArtifact: FormulaExtractorOutput | null,
  ): boolean {
    const parserFormula = this.parserFormula(sourcePack.knownParserOutput);
    if (!parserFormula || !selectedArtifact) {
      return false;
    }
    const normalizedParser = this.normalizedFormula(parserFormula);
    if (!normalizedParser) {
      return false;
    }
    const selectedFormulas = selectedArtifact.components
      .map((component) => this.normalizedFormula(component.formulaText))
      .filter((formula): formula is string => !!formula);
    return (
      selectedFormulas.length > 0 &&
      !selectedFormulas.some((formula) => formula === normalizedParser)
    );
  }

  async createMismatchPacket(args: {
    sourcePack: FormulaSourcePack;
    comparison: FormulaLlmComparisonResult;
    metadata?: JsonRecord | null;
  }): Promise<EvidenceReconciliationPacketEntity | null> {
    if (
      args.comparison.agreementStatus === 'matched' &&
      !args.comparison.requiresHumanReview
    ) {
      return null;
    }
    return this.reconciliation.createPacketForScope({
      htsNumber: args.sourcePack.htsNumber,
      countryCode: args.sourcePack.originCountry,
      destinationCode: args.sourcePack.destinationCountry,
      reason: 'multi_llm_formula_disagreement',
      metadata: {
        source: 'formula-llm-comparison-service',
        sourcePackId: args.sourcePack.sourcePackId,
        comparison: toJsonRecord(args.comparison),
        ...(args.metadata || {}),
      },
    });
  }

  private diffArtifacts(
    codex: FormulaExtractorOutput,
    qwen: FormulaExtractorOutput,
  ): FormulaLlmDifference[] {
    const differences: FormulaLlmDifference[] = [];
    if (codex.verdict !== qwen.verdict) {
      differences.push({
        field: 'verdict',
        codexValue: codex.verdict,
        qwenValue: qwen.verdict,
        severity: 'P1',
        reason: 'Extractor verdicts differ',
      });
    }
    if (codex.components.length !== qwen.components.length) {
      differences.push({
        field: 'components.length',
        codexValue: codex.components.length,
        qwenValue: qwen.components.length,
        severity: 'P1',
        reason: 'Component counts differ',
      });
    }

    const max = Math.max(codex.components.length, qwen.components.length);
    for (let index = 0; index < max; index++) {
      const left = codex.components[index] || null;
      const right = qwen.components[index] || null;
      if (!left || !right) {
        continue;
      }
      this.compareComponent(index, left, right, differences);
    }
    return differences;
  }

  private compareComponent(
    index: number,
    codex: FormulaComponentArtifact,
    qwen: FormulaComponentArtifact,
    differences: FormulaLlmDifference[],
  ): void {
    const fields: Array<keyof FormulaComponentArtifact> = [
      'componentType',
      'sourceRateText',
      'formulaText',
    ];
    for (const field of fields) {
      if (codex[field] !== qwen[field]) {
        const semanticEquivalent =
          field === 'formulaText' &&
          this.normalizedFormula(codex.formulaText) ===
            this.normalizedFormula(qwen.formulaText);
        differences.push({
          field: `components[${index}].${field}`,
          codexValue: codex[field],
          qwenValue: qwen[field],
          severity: semanticEquivalent ? 'P3' : 'P1',
          reason: semanticEquivalent
            ? 'Formula text differs but canonical formula is equivalent'
            : 'Component field differs',
        });
      }
    }
    for (const field of [
      'formulaAst',
      'conditionAst',
      'unitDimensions',
      'constraints',
      'roundingPolicy',
      'citations',
      'testVectors',
      'assumptions',
      'blockers',
    ] as const) {
      if (stableStringify(codex[field]) !== stableStringify(qwen[field])) {
        differences.push({
          field: `components[${index}].${field}`,
          codexValue: codex[field],
          qwenValue: qwen[field],
          severity: 'P2',
          reason: 'Structured component metadata differs',
        });
      }
    }
  }

  private semanticHashes(output: FormulaExtractorOutput | null): string[] {
    if (!output) {
      return [];
    }
    return output.components.map((component) => {
      const formulaHash = component.formulaText
        ? this.semantics.analyze(component.formulaText).semanticHash
        : 'null';
      return stableStringify({
        componentType: component.componentType,
        formulaHash,
        conditionAst: component.conditionAst,
        unitDimensions: component.unitDimensions,
        constraints: component.constraints,
        roundingPolicy: component.roundingPolicy,
      });
    });
  }

  private normalizedFormula(formula: string | null): string | null {
    return this.semantics.normalizeForSemanticComparison(formula);
  }

  private unsupportedVerdictReasons(output: FormulaExtractorOutput): string[] {
    const reasons: string[] = [];
    if (output.verdict === 'unsupported') {
      reasons.push('Extractor marked the formula unsupported');
    }
    return reasons;
  }

  private parserFormula(parserOutput: JsonRecord): string | null {
    for (const key of [
      'formulaText',
      'formula',
      'rateFormula',
      'compiledFormula',
    ]) {
      const value = parserOutput[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
    return null;
  }

  private highRiskReasons(sourcePack: FormulaSourcePack): string[] {
    const combined = [
      sourcePack.rateText,
      sourcePack.specialRateText,
      sourcePack.otherRateText,
      sourcePack.chapter99Text,
      stableStringify(sourcePack.chapterNotes),
      stableStringify(sourcePack.chapter99Candidates),
    ]
      .filter((value): value is string => !!value)
      .join(' ')
      .toLowerCase();
    const reasons: string[] = [];
    const patterns: Array<[RegExp, string]> = [
      [/section[_\s-]*301|9903\.(88|91|92)\./, 'section_301'],
      [/section[_\s-]*232|9903\.(74|76|78|79|80|81|85|94)\./, 'section_232'],
      [/section[_\s-]*122/, 'section_122'],
      [/section[_\s-]*201|9903\.45\./, 'section_201'],
      [/section[_\s-]*421|9903\.40\./, 'section_421'],
      [/reciprocal|ieepa|9903\.01\./, 'reciprocal_ieepa'],
      [/quota|9903\.(17|18|52|54|55)\./, 'quota'],
      [/safeguard/, 'safeguard'],
      [/temporary_duty_suspension|9902\./, 'temporary_duty_suspension'],
      [/retaliat/, 'retaliatory_tariff'],
      [/chapter\s*99|9903\./, 'chapter_99'],
      [/not\s+(less|more)\s+than/, 'min_max_constraint'],
      [/whichever|higher|lower/, 'choice_formula'],
      [/see\s+(note|additional)/, 'note_derived'],
      [/range|from\s+\d|to\s+\d/, 'range_or_tier'],
      [/(kg|doz|dozen|pair|liter|proof|m2|ton|gross)/, 'unit_conversion'],
    ];
    for (const [pattern, reason] of patterns) {
      if (pattern.test(combined)) {
        reasons.push(reason);
      }
    }
    return Array.from(new Set(reasons));
  }
}
