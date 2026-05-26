import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { BatchRateLineResult } from '../../calculator/services/tariff-types';
import { FormulaSemanticsService } from '../../calculator/services/formula-semantics.service';
import { ExternalProviderFormulaEntity } from '@hts/core';
import { BrokerGoldenSetCaseEntity } from '../entities/broker-golden-set-case.entity';
import { ExternalProviderQuoteEntity } from '../entities/external-provider-quote.entity';
import { ParityComparisonRowEntity } from '../entities/parity-comparison-row.entity';
import type {
  FormulaExtractorOutput,
  FormulaSourcePack,
} from './formula-ai-validation.schemas';

export type FormulaValidationSource =
  | 'LOCAL_CALCULATOR'
  | 'AI_SERVICE_PARITY'
  | 'LLM_COUNCIL'
  | 'FLEXPORT'
  | 'EXTERNAL_PROVIDER'
  | 'BROKER_GOLDEN_SET'
  | 'OFFICIAL_SOURCE';

export interface FormulaValidationInputContext {
  htsNumber: string;
  originCountry: string;
  destinationCountry: string;
  entryDate: string | null;
  dateOfLoading?: string | null;
  modeOfTransport?: string | null;
  enteredValue: number | null;
  currency: string;
  quantityInputs: Record<string, unknown>;
  materialInputs: Record<string, unknown>;
  chapter99Selections: Record<string, unknown>;
  spiSelections: Record<string, unknown>;
}

export interface FormulaValidationComponent {
  componentKey: string;
  componentType: string;
  programFamily: string | null;
  chapter99HtsCode: string | null;
  rateClass: string | null;
  sourceRateText: string | null;
  formulaText: string | null;
  formulaCanonical: string | null;
  formulaSemanticHash: string | null;
  conditionAst: Record<string, unknown> | null;
  calculationBasis: string | null;
  amount: number | null;
  currency: string;
  citations: Array<Record<string, unknown>>;
  warnings: string[];
  raw: Record<string, unknown>;
}

export interface FormulaValidationArtifact {
  artifactVersion: 'formula-validation-artifact-v1';
  source: FormulaValidationSource;
  sourceId: string | null;
  inputContext: FormulaValidationInputContext;
  components: FormulaValidationComponent[];
  totals: {
    enteredValue: number | null;
    duty: number | null;
    fees: number | null;
    taxes: number | null;
    payable: number | null;
    landedCost: number | null;
  };
  rawEvidenceRefs: Array<Record<string, unknown>>;
  warnings: string[];
  generatedAt: string;
}

export interface FormulaValidationDifference {
  severity: 'P1' | 'P2' | 'P3';
  kind:
    | 'missing_component'
    | 'extra_component'
    | 'amount_mismatch'
    | 'formula_mismatch'
    | 'condition_mismatch'
    | 'total_mismatch'
    | 'input_context_mismatch';
  componentKey?: string;
  message: string;
  leftValue?: unknown;
  rightValue?: unknown;
}

export interface FormulaValidationComparison {
  isMatch: boolean;
  agreementStatus:
    | 'matched'
    | 'different'
    | 'input_context_not_equivalent'
    | 'component_mismatch'
    | 'total_mismatch';
  differences: FormulaValidationDifference[];
  tolerance: number;
}

export interface FormulaValidationSourceAdapter<TInput = unknown> {
  readonly source: FormulaValidationSource;
  buildArtifact(input: TInput): Promise<FormulaValidationArtifact>;
}

@Injectable()
export class FormulaValidationArtifactService {
  constructor(private readonly formulaSemantics: FormulaSemanticsService) {}

  fromLocalCalculator(
    input: {
      htsNumber: string;
      originCountry: string;
      destinationCountry?: string;
      entryDate?: string | null;
      modeOfTransport?: string | null;
      currency?: string;
      inputs?: Record<string, unknown>;
      chapter99Selections?: Record<string, unknown>;
      spiSelections?: Record<string, unknown>;
    },
    result: BatchRateLineResult,
  ): FormulaValidationArtifact {
    const context = this.inputContext({
      htsNumber: input.htsNumber,
      originCountry: input.originCountry,
      destinationCountry: input.destinationCountry,
      entryDate: input.entryDate,
      modeOfTransport: input.modeOfTransport,
      currency: input.currency,
      inputs: input.inputs,
      chapter99Selections: input.chapter99Selections,
      spiSelections: input.spiSelections,
    });
    const components = result.breakdown.map((component) =>
      this.component(context, {
        componentType: component.componentType,
        programFamily: component.programFamily || null,
        chapter99HtsCode: component.chapter99HtsCode || null,
        rateClass: null,
        sourceRateText: component.rateText || null,
        formulaText: component.formula || null,
        formulaCanonical: component.formulaCanonical || null,
        formulaSemanticHash: component.formulaSemanticHash || null,
        conditionAst: component.conditions || null,
        calculationBasis: this.inferCalculationBasis(component.formula),
        amount: this.number(component.amount),
        currency: context.currency,
        citations: component.sourceCitation
          ? [{ ...component.sourceCitation }]
          : [],
        warnings: component.error ? [component.error] : [],
        raw: component as Record<string, unknown>,
      }),
    );

    return this.artifact({
      source: 'LOCAL_CALCULATOR',
      sourceId: result.effectiveHtsCode || result.htsCode,
      inputContext: context,
      components,
      totals: {
        enteredValue: context.enteredValue,
        duty: this.number(result.totals?.duty ?? result.totalDuty),
        fees: this.number(result.totals?.fees ?? result.fees),
        taxes: this.number(result.totals?.taxes ?? result.taxes),
        payable: this.number(result.totals?.payable),
        landedCost:
          context.enteredValue !== null && result.totals?.payable !== undefined
            ? context.enteredValue + Number(result.totals.payable)
            : null,
      },
      rawEvidenceRefs: (result.sources || []).map((source) => ({ ...source })),
      warnings: [
        ...(result.blocked ? [result.blockReason || 'LOCAL_BLOCKED'] : []),
      ],
    });
  }

  fromExternalProviderSnapshot(
    snapshot: ExternalProviderFormulaEntity,
  ): FormulaValidationArtifact {
    const provider =
      snapshot.provider === 'FLEXPORT' ? 'FLEXPORT' : 'EXTERNAL_PROVIDER';
    const context = this.inputContext({
      htsNumber: snapshot.htsNumber,
      originCountry: snapshot.countryCode,
      destinationCountry: 'US',
      entryDate: snapshot.entryDate,
      modeOfTransport: snapshot.modeOfTransport,
      inputs: snapshot.inputContext || {},
    });
    const providerComponents = this.componentsFromProviderPayload(
      context,
      snapshot.formulaComponents,
      snapshot.outputBreakdown,
    );
    const totalDuty = this.findFirstNumberByKey(snapshot.outputBreakdown, [
      'providerTotalDuty',
      'totalDuty',
      'totalDutyUsd',
      'total_duty',
      'dutyTotal',
      'importDuty',
      'totalImportDuty',
    ]);

    return this.artifact({
      source: provider,
      sourceId: snapshot.id,
      inputContext: context,
      components: providerComponents,
      totals: {
        enteredValue: context.enteredValue,
        duty: totalDuty,
        fees: this.findFirstNumberByKey(snapshot.outputBreakdown, [
          'fees',
          'totalFees',
        ]),
        taxes: this.findFirstNumberByKey(snapshot.outputBreakdown, [
          'taxes',
          'totalTaxes',
        ]),
        payable: totalDuty,
        landedCost:
          context.enteredValue !== null && totalDuty !== null
            ? context.enteredValue + totalDuty
            : null,
      },
      rawEvidenceRefs: [
        {
          provider: snapshot.provider,
          sourceUrl: snapshot.sourceUrl,
          contextHash: snapshot.contextHash,
        },
      ],
      warnings: [],
    });
  }

  fromExternalProviderQuote(
    quote: ExternalProviderQuoteEntity,
    side: 'provider' | 'local' = 'provider',
  ): FormulaValidationArtifact {
    const context = this.inputContext({
      htsNumber: quote.htsNumber,
      originCountry: quote.originCountry,
      destinationCountry: quote.destinationCountry,
      entryDate: quote.entryDate,
      currency: quote.currency,
      inputs: quote.query || { value: Number(quote.declaredValue) },
    });
    const source =
      side === 'local'
        ? 'LOCAL_CALCULATOR'
        : quote.provider === 'FLEXPORT'
          ? 'FLEXPORT'
          : 'EXTERNAL_PROVIDER';
    const components =
      side === 'provider'
        ? quote.providerComponents || []
        : quote.localComponents || [];
    const declaredValue = this.number(quote.declaredValue);
    const totalDuty =
      side === 'provider'
        ? this.number(quote.providerTotalDuty)
        : this.number(quote.localTotalDuty);

    return this.artifact({
      source,
      sourceId: quote.id,
      inputContext: context,
      components: components.map((component) =>
        this.componentFromLooseRecord(context, component),
      ),
      totals: {
        enteredValue: declaredValue,
        duty: totalDuty,
        fees: null,
        taxes: null,
        payable: totalDuty,
        landedCost:
          declaredValue !== null && totalDuty !== null
            ? declaredValue + totalDuty
            : null,
      },
      rawEvidenceRefs: [
        {
          provider: quote.provider,
          rawResponseUri: quote.rawResponseUri,
          queryHash: quote.queryHash,
        },
      ],
      warnings:
        quote.agreementStatus === 'mismatched' ? ['provider_mismatch'] : [],
    });
  }

  fromBrokerGoldenSetCase(
    brokerCase: BrokerGoldenSetCaseEntity,
  ): FormulaValidationArtifact {
    const context = this.inputContext({
      htsNumber: brokerCase.htsNumber,
      originCountry: brokerCase.originCountry,
      destinationCountry: brokerCase.destinationCountry,
      entryDate: brokerCase.entryDate,
      currency: brokerCase.currency,
      inputs: {
        ...(brokerCase.inputs || {}),
        value: Number(brokerCase.declaredValue),
      },
    });

    const declaredValue = this.number(brokerCase.declaredValue);
    const expectedTotalDuty = this.number(brokerCase.expectedTotalDuty);
    return this.artifact({
      source: 'BROKER_GOLDEN_SET',
      sourceId: brokerCase.id,
      inputContext: context,
      components: (brokerCase.expectedComponents || []).map((component) =>
        this.componentFromLooseRecord(context, component),
      ),
      totals: {
        enteredValue: declaredValue,
        duty: expectedTotalDuty,
        fees: null,
        taxes: null,
        payable: expectedTotalDuty,
        landedCost:
          declaredValue !== null && expectedTotalDuty !== null
            ? declaredValue + expectedTotalDuty
            : null,
      },
      rawEvidenceRefs: brokerCase.citations || [],
      warnings:
        brokerCase.status !== 'active' ? [`status:${brokerCase.status}`] : [],
    });
  }

  fromLlmCouncil(
    sourcePack: FormulaSourcePack,
    output: FormulaExtractorOutput,
    sourceId: string | null = null,
  ): FormulaValidationArtifact {
    const context = this.inputContext({
      htsNumber: sourcePack.htsNumber,
      originCountry: sourcePack.originCountry,
      destinationCountry: sourcePack.destinationCountry,
      entryDate: sourcePack.effectiveDate,
      inputs: {},
    });

    return this.artifact({
      source: 'LLM_COUNCIL',
      sourceId,
      inputContext: context,
      components: output.components.map((component) =>
        this.component(context, {
          componentType: this.mapLlmComponentType(component.componentType),
          programFamily: null,
          chapter99HtsCode: this.stringValue(
            (component as any).chapter99HtsCode,
          ),
          rateClass: null,
          sourceRateText: component.sourceRateText,
          formulaText: component.formulaText,
          formulaCanonical: this.normalizeFormula(component.formulaText),
          formulaSemanticHash: this.semanticHash(component.formulaText),
          conditionAst: component.conditionAst,
          calculationBasis: this.inferCalculationBasis(component.formulaText),
          amount: null,
          currency: context.currency,
          citations: component.citations,
          warnings: [...component.assumptions, ...component.blockers],
          raw: component as Record<string, unknown>,
        }),
      ),
      totals: {
        enteredValue: context.enteredValue,
        duty: null,
        fees: null,
        taxes: null,
        payable: null,
        landedCost: null,
      },
      rawEvidenceRefs: [{ sourcePackId: sourcePack.sourcePackId }],
      warnings: output.reasonCodes,
    });
  }

  fromAiServiceParityRow(
    row: ParityComparisonRowEntity,
    side: 'ai' | 'local',
  ): FormulaValidationArtifact {
    const context = this.inputContext({
      htsNumber: row.htsNumber,
      originCountry: row.countryOfOrigin,
      destinationCountry: 'US',
      inputs: { ...(row.inputs || {}), value: Number(row.declaredValue) },
    });
    const rawComponents =
      side === 'ai'
        ? this.arrayFromUnknown(row.aiFormulas)
        : this.arrayFromUnknown(row.localBreakdown);
    const totalDuty =
      side === 'ai'
        ? this.number(row.aiTotalDuty)
        : this.number(row.localTotalDuty);

    return this.artifact({
      source: 'AI_SERVICE_PARITY',
      sourceId: row.id,
      inputContext: context,
      components: rawComponents.map((component) =>
        this.componentFromLooseRecord(context, component),
      ),
      totals: {
        enteredValue: context.enteredValue,
        duty: totalDuty,
        fees: null,
        taxes: null,
        payable: totalDuty,
        landedCost:
          context.enteredValue !== null && totalDuty !== null
            ? context.enteredValue + totalDuty
            : null,
      },
      rawEvidenceRefs: [{ runId: row.runId, side }],
      warnings: [
        side === 'ai' ? row.aiBlockReason : row.localBlockReason,
      ].filter((value): value is string => !!value),
    });
  }

  compareArtifacts(
    left: FormulaValidationArtifact,
    right: FormulaValidationArtifact,
    options: { tolerance?: number } = {},
  ): FormulaValidationComparison {
    const tolerance = options.tolerance ?? 0.01;
    const differences: FormulaValidationDifference[] = [];
    if (!this.contextEquivalent(left.inputContext, right.inputContext)) {
      differences.push({
        severity: 'P1',
        kind: 'input_context_mismatch',
        message: 'Validation artifacts do not use the same input context.',
        leftValue: left.inputContext,
        rightValue: right.inputContext,
      });
      return {
        isMatch: false,
        agreementStatus: 'input_context_not_equivalent',
        differences,
        tolerance,
      };
    }

    const leftComponents = new Map(
      left.components.map((component) => [component.componentKey, component]),
    );
    const rightComponents = new Map(
      right.components.map((component) => [component.componentKey, component]),
    );
    const keys = Array.from(
      new Set([...leftComponents.keys(), ...rightComponents.keys()]),
    ).sort();

    for (const key of keys) {
      const leftComponent = leftComponents.get(key);
      const rightComponent = rightComponents.get(key);
      if (!leftComponent) {
        differences.push({
          severity: 'P1',
          kind: 'extra_component',
          componentKey: key,
          message: 'Right artifact has a component missing from left artifact.',
          rightValue: rightComponent,
        });
        continue;
      }
      if (!rightComponent) {
        differences.push({
          severity: 'P1',
          kind: 'missing_component',
          componentKey: key,
          message: 'Left artifact has a component missing from right artifact.',
          leftValue: leftComponent,
        });
        continue;
      }
      if (
        leftComponent.amount !== null &&
        rightComponent.amount !== null &&
        Math.abs(leftComponent.amount - rightComponent.amount) > tolerance
      ) {
        differences.push({
          severity: 'P1',
          kind: 'amount_mismatch',
          componentKey: key,
          message: 'Component amounts differ beyond tolerance.',
          leftValue: leftComponent.amount,
          rightValue: rightComponent.amount,
        });
      }
      if (
        leftComponent.formulaSemanticHash &&
        rightComponent.formulaSemanticHash &&
        leftComponent.formulaSemanticHash !== rightComponent.formulaSemanticHash
      ) {
        differences.push({
          severity: 'P2',
          kind: 'formula_mismatch',
          componentKey: key,
          message: 'Component formulas are not semantically equivalent.',
          leftValue:
            leftComponent.formulaCanonical || leftComponent.formulaText,
          rightValue:
            rightComponent.formulaCanonical || rightComponent.formulaText,
        });
      }
      if (
        JSON.stringify(this.normalizeJson(leftComponent.conditionAst || {})) !==
        JSON.stringify(this.normalizeJson(rightComponent.conditionAst || {}))
      ) {
        differences.push({
          severity: 'P2',
          kind: 'condition_mismatch',
          componentKey: key,
          message: 'Component applicability conditions differ.',
          leftValue: leftComponent.conditionAst,
          rightValue: rightComponent.conditionAst,
        });
      }
    }

    if (
      left.totals.duty !== null &&
      right.totals.duty !== null &&
      Math.abs(left.totals.duty - right.totals.duty) > tolerance
    ) {
      differences.push({
        severity: 'P1',
        kind: 'total_mismatch',
        message: 'Total duty differs beyond tolerance.',
        leftValue: left.totals.duty,
        rightValue: right.totals.duty,
      });
    }

    const componentMismatch = differences.some(
      (difference) =>
        difference.kind !== 'total_mismatch' &&
        difference.kind !== 'input_context_mismatch',
    );
    return {
      isMatch: differences.length === 0,
      agreementStatus:
        differences.length === 0
          ? 'matched'
          : componentMismatch
            ? 'component_mismatch'
            : 'total_mismatch',
      differences,
      tolerance,
    };
  }

  private artifact(input: {
    source: FormulaValidationSource;
    sourceId: string | null;
    inputContext: FormulaValidationInputContext;
    components: FormulaValidationComponent[];
    totals: FormulaValidationArtifact['totals'];
    rawEvidenceRefs: Array<Record<string, unknown>>;
    warnings: string[];
  }): FormulaValidationArtifact {
    return {
      artifactVersion: 'formula-validation-artifact-v1',
      source: input.source,
      sourceId: input.sourceId,
      inputContext: input.inputContext,
      components: input.components,
      totals: input.totals,
      rawEvidenceRefs: input.rawEvidenceRefs,
      warnings: input.warnings,
      generatedAt: new Date().toISOString(),
    };
  }

  private inputContext(input: {
    htsNumber: string;
    originCountry: string;
    destinationCountry?: string;
    entryDate?: string | null;
    dateOfLoading?: string | null;
    modeOfTransport?: string | null;
    currency?: string;
    inputs?: Record<string, unknown>;
    chapter99Selections?: Record<string, unknown>;
    spiSelections?: Record<string, unknown>;
  }): FormulaValidationInputContext {
    const inputs = input.inputs || {};
    return {
      htsNumber: this.normalizeHts(input.htsNumber),
      originCountry: (input.originCountry || '').toUpperCase(),
      destinationCountry: (input.destinationCountry || 'US').toUpperCase(),
      entryDate: input.entryDate || null,
      dateOfLoading:
        input.dateOfLoading || this.stringValue(inputs.dateOfLoading) || null,
      modeOfTransport:
        input.modeOfTransport ||
        this.stringValue(inputs.modeOfTransport) ||
        null,
      enteredValue:
        this.number(inputs.value) ??
        this.number(inputs.enteredValue) ??
        this.number(inputs.declaredValue),
      currency: (
        input.currency ||
        this.stringValue(inputs.currency) ||
        'USD'
      ).toUpperCase(),
      quantityInputs: this.pickPrefixed(inputs, [
        'quantity',
        'weight',
        'volume',
        'area',
        'length',
        'proof',
      ]),
      materialInputs: {
        ...this.pickPrefixed(inputs, ['aluminum', 'steel', 'copper']),
      },
      chapter99Selections:
        input.chapter99Selections ||
        this.recordValue(inputs.chapter99Selections) ||
        {},
      spiSelections:
        input.spiSelections || this.recordValue(inputs.spiSelections) || {},
    };
  }

  private component(
    context: FormulaValidationInputContext,
    input: Omit<FormulaValidationComponent, 'componentKey'>,
  ): FormulaValidationComponent {
    const formulaCanonical =
      input.formulaCanonical || this.normalizeFormula(input.formulaText);
    const formulaSemanticHash =
      input.formulaSemanticHash || this.semanticHash(input.formulaText);
    const prepared = {
      ...input,
      formulaCanonical,
      formulaSemanticHash,
      componentType: input.componentType || 'unknown',
      programFamily: input.programFamily || null,
      chapter99HtsCode: input.chapter99HtsCode
        ? this.normalizeHts(input.chapter99HtsCode)
        : null,
      currency: input.currency || context.currency,
    };
    return {
      ...prepared,
      componentKey: this.componentKey(context, prepared),
    };
  }

  private componentFromLooseRecord(
    context: FormulaValidationInputContext,
    raw: Record<string, unknown>,
  ): FormulaValidationComponent {
    const componentType = this.mapLooseComponentType(
      this.stringValue(raw.componentType) ||
        this.stringValue(raw.tariffType) ||
        this.stringValue(raw.type),
    );
    const formulaText =
      this.stringValue(raw.formulaText) ||
      this.stringValue(raw.formula) ||
      this.stringValue(raw.compiledFormula);
    return this.component(context, {
      componentType,
      programFamily:
        this.stringValue(raw.programFamily) ||
        this.stringValue(raw.program_family) ||
        null,
      chapter99HtsCode:
        this.stringValue(raw.chapter99HtsCode) ||
        this.stringValue(raw.chapter99_hts_code) ||
        this.stringValue(raw.htsCode) ||
        null,
      rateClass: this.stringValue(raw.rateClass),
      sourceRateText:
        this.stringValue(raw.sourceRateText) || this.stringValue(raw.rateText),
      formulaText,
      formulaCanonical: this.stringValue(raw.formulaCanonical),
      formulaSemanticHash: this.stringValue(raw.formulaSemanticHash),
      conditionAst: this.recordValue(raw.conditionAst || raw.conditions),
      calculationBasis:
        this.stringValue(raw.calculationBasis) ||
        this.inferCalculationBasis(formulaText),
      amount:
        this.number(raw.amount) ??
        this.number(raw.total) ??
        this.number(raw.duty),
      currency: context.currency,
      citations: this.arrayFromUnknown(raw.citations || raw.sourceCitation),
      warnings: [],
      raw,
    });
  }

  private componentsFromProviderPayload(
    context: FormulaValidationInputContext,
    formulaComponents: Record<string, unknown> | null,
    outputBreakdown: Record<string, unknown> | null,
  ): FormulaValidationComponent[] {
    const arrays = [
      this.findFirstArrayByKey(formulaComponents, ['components', 'breakdown']),
      this.findFirstArrayByKey(outputBreakdown, [
        'components',
        'breakdown',
        'charges',
        'duties',
        'tariffs',
        'lineItems',
      ]),
    ].find((items) => items.length > 0);
    if (arrays && arrays.length > 0) {
      return arrays.map((item) => this.componentFromLooseRecord(context, item));
    }
    const formulaText =
      this.stringValue(formulaComponents?.normalized) ||
      this.stringValue(formulaComponents?.formulaText) ||
      this.stringValue(formulaComponents?.formula);
    const totalDuty = this.findFirstNumberByKey(outputBreakdown, [
      'totalDuty',
      'totalDutyUsd',
      'total_duty',
      'providerTotalDuty',
    ]);
    if (!formulaText && totalDuty === null) {
      return [];
    }
    return [
      this.component(context, {
        componentType: 'unknown',
        programFamily: null,
        chapter99HtsCode: null,
        rateClass: null,
        sourceRateText: null,
        formulaText,
        formulaCanonical: this.normalizeFormula(formulaText),
        formulaSemanticHash: this.semanticHash(formulaText),
        conditionAst: null,
        calculationBasis: this.inferCalculationBasis(formulaText),
        amount: totalDuty,
        currency: context.currency,
        citations: [],
        warnings: [],
        raw: {
          formulaComponents: formulaComponents || null,
          outputBreakdown: outputBreakdown || null,
        },
      }),
    ];
  }

  private componentKey(
    context: FormulaValidationInputContext,
    component: Omit<FormulaValidationComponent, 'componentKey'>,
  ): string {
    const keyParts = {
      htsNumber: context.htsNumber,
      originCountry: context.originCountry,
      destinationCountry: context.destinationCountry,
      componentType: component.componentType,
      programFamily: component.programFamily || '',
      chapter99HtsCode: component.chapter99HtsCode || '',
      rateClass: component.rateClass || '',
      calculationBasis: component.calculationBasis || '',
    };
    return createHash('sha256')
      .update(JSON.stringify(this.normalizeJson(keyParts)))
      .digest('hex');
  }

  private contextEquivalent(
    left: FormulaValidationInputContext,
    right: FormulaValidationInputContext,
  ): boolean {
    return (
      JSON.stringify(this.normalizeJson(left)) ===
      JSON.stringify(this.normalizeJson(right))
    );
  }

  private normalizeFormula(value: string | null | undefined): string | null {
    if (!value) return null;
    return this.formulaSemantics.normalizeForSemanticComparison(value);
  }

  private semanticHash(value: string | null | undefined): string | null {
    if (!value) return null;
    return this.formulaSemantics.analyze(value).semanticHash;
  }

  private inferCalculationBasis(
    formula: string | null | undefined,
  ): string | null {
    if (!formula) return null;
    const normalized = formula.toLowerCase();
    if (normalized.includes('aluminum')) return 'aluminum_value';
    if (normalized.includes('steel')) return 'steel_value';
    if (normalized.includes('copper')) return 'copper_value';
    if (/\bduty\b/.test(normalized)) return 'duty';
    if (/\btotal\b/.test(normalized)) return 'total';
    if (/\bvalue\b/.test(normalized)) return 'entered_value';
    return null;
  }

  private mapLlmComponentType(value: string): string {
    if (value === 'baseDuty') return 'base';
    if (value === 'additionalDuty') return 'chapter_99';
    if (value === 'specificDuty' || value === 'compoundDuty') return 'base';
    return value || 'unknown';
  }

  private mapLooseComponentType(value: string | null): string {
    if (!value) return 'unknown';
    const normalized = value.toLowerCase();
    if (normalized === 'generalduty' || normalized === 'general') return 'base';
    if (normalized === 'additionalduty') return 'chapter_99';
    return normalized;
  }

  private normalizeHts(value: string): string {
    return String(value || '').trim();
  }

  private number(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(/[$,%\s,]/g, ''));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private recordValue(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private arrayFromUnknown(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
      const record = this.recordValue(value);
      return record ? [record] : [];
    }
    return value.filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object' && !Array.isArray(item),
    );
  }

  private pickPrefixed(
    source: Record<string, unknown>,
    prefixes: string[],
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      const lower = key.toLowerCase();
      if (prefixes.some((prefix) => lower.startsWith(prefix.toLowerCase()))) {
        out[key] = value;
      }
    }
    return out;
  }

  private findFirstNumberByKey(
    value: unknown,
    keys: string[],
    depth = 0,
  ): number | null {
    if (depth > 6 || value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findFirstNumberByKey(item, keys, depth + 1);
        if (found !== null) return found;
      }
      return null;
    }
    if (typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const lowerKeyMap = new Map(
      Object.keys(record).map((key) => [key.toLowerCase(), key]),
    );
    for (const key of keys) {
      const actualKey = lowerKeyMap.get(key.toLowerCase());
      if (!actualKey) continue;
      const numeric = this.number(record[actualKey]);
      if (numeric !== null) return numeric;
    }
    for (const item of Object.values(record)) {
      const found = this.findFirstNumberByKey(item, keys, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }

  private findFirstArrayByKey(
    value: unknown,
    keys: string[],
    depth = 0,
  ): Array<Record<string, unknown>> {
    if (depth > 6 || value === null || value === undefined) return [];
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      );
    }
    if (typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    const lowerKeyMap = new Map(
      Object.keys(record).map((key) => [key.toLowerCase(), key]),
    );
    for (const key of keys) {
      const actualKey = lowerKeyMap.get(key.toLowerCase());
      if (!actualKey) continue;
      const found = this.findFirstArrayByKey(
        record[actualKey],
        keys,
        depth + 1,
      );
      if (found.length > 0) return found;
    }
    for (const item of Object.values(record)) {
      const found = this.findFirstArrayByKey(item, keys, depth + 1);
      if (found.length > 0) return found;
    }
    return [];
  }

  private normalizeJson(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeJson(item));
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) {
        out[key] = this.normalizeJson(record[key]);
      }
      return out;
    }
    return value;
  }
}
