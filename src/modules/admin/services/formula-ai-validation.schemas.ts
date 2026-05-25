import { z } from 'zod';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonRecord = Record<string, JsonValue>;

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonRecordSchema = z.record(z.string(), JsonValueSchema);

export const FormulaComponentTypeSchema = z.enum([
  'baseDuty',
  'additionalDuty',
  'specificDuty',
  'compoundDuty',
  'mpf',
  'hmf',
  'excise',
  'unknown',
]);

export const FormulaExtractorVerdictSchema = z.enum([
  'formula_extracted',
  'no_duty',
  'needs_human_review',
  'unsupported',
]);

export const FormulaComponentArtifactSchema = z
  .object({
    componentType: FormulaComponentTypeSchema,
    sourceRateText: z.string().nullable(),
    formulaText: z.string().nullable(),
    formulaAst: JsonRecordSchema.nullable(),
    conditionAst: JsonRecordSchema.nullable(),
    unitDimensions: JsonRecordSchema.nullable(),
    constraints: z.array(JsonRecordSchema).default([]),
    roundingPolicy: JsonRecordSchema.nullable(),
    citations: z.array(JsonRecordSchema).default([]),
    testVectors: z.array(JsonRecordSchema).default([]),
    assumptions: z.array(z.string()).default([]),
    blockers: z.array(z.string()).default([]),
  })
  .strict();

export const FormulaExtractorOutputSchema = z
  .object({
    modelRole: z.literal('extractor'),
    verdict: FormulaExtractorVerdictSchema,
    components: z.array(FormulaComponentArtifactSchema).default([]),
    confidence: z.number().min(0).max(1),
    reasonCodes: z.array(z.string()).default([]),
    needsJudge: z.boolean().default(false),
  })
  .strict();

export const FormulaJudgeOutputSchema = z
  .object({
    judgeVerdict: z.enum([
      'codex_correct',
      'qwen_correct',
      'both_equivalent',
      'neither_correct',
      'insufficient_evidence',
      'needs_human_review',
    ]),
    selectedArtifact: JsonRecordSchema.nullable(),
    corrections: z.array(JsonRecordSchema).default([]),
    citationsUsed: z.array(JsonRecordSchema).default([]),
    riskLevel: z.enum(['P1', 'P2', 'P3']),
    humanReviewRequired: z.boolean(),
    skillFeedback: z.array(JsonRecordSchema).default([]),
  })
  .strict();

export const FormulaSourcePackSchema = z
  .object({
    sourcePackId: z.string(),
    htsNumber: z.string(),
    sourceVersion: z.string(),
    effectiveDate: z.string().nullable(),
    destinationCountry: z.string(),
    originCountry: z.string(),
    articleDescription: z.string().nullable(),
    unit: z.string().nullable(),
    rateText: z.string().nullable(),
    specialRateText: z.string().nullable(),
    otherRateText: z.string().nullable(),
    chapter99Text: z.string().nullable(),
    chapterNotes: z.array(JsonRecordSchema).default([]),
    sectionNotes: z.array(JsonRecordSchema).default([]),
    generalNotes: z.array(JsonRecordSchema).default([]),
    chapter99Candidates: z.array(JsonRecordSchema).default([]),
    currentFormulaArtifact: JsonRecordSchema,
    knownParserOutput: JsonRecordSchema,
    knownBrokerCases: z.array(JsonRecordSchema).default([]),
    knownProviderQuotes: z.array(JsonRecordSchema).default([]),
    knownEvidence: z.array(JsonRecordSchema).default([]),
    knownCards: z.array(JsonRecordSchema).default([]),
    requiredOutputSchemaVersion: z.literal('formula-artifact-v1'),
    metadata: JsonRecordSchema,
  })
  .strict();

export type FormulaComponentArtifact = z.infer<
  typeof FormulaComponentArtifactSchema
>;
export type FormulaExtractorOutput = z.infer<
  typeof FormulaExtractorOutputSchema
>;
export type FormulaJudgeOutput = z.infer<typeof FormulaJudgeOutputSchema>;
export type FormulaSourcePack = z.infer<typeof FormulaSourcePackSchema>;

export const formulaExtractorOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'modelRole',
    'verdict',
    'components',
    'confidence',
    'reasonCodes',
    'needsJudge',
  ],
  properties: {
    modelRole: { const: 'extractor' },
    verdict: {
      enum: [
        'formula_extracted',
        'no_duty',
        'needs_human_review',
        'unsupported',
      ],
    },
    components: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'componentType',
          'sourceRateText',
          'formulaText',
          'formulaAst',
          'conditionAst',
          'unitDimensions',
          'constraints',
          'roundingPolicy',
          'citations',
          'testVectors',
          'assumptions',
          'blockers',
        ],
        properties: {
          componentType: {
            enum: [
              'baseDuty',
              'additionalDuty',
              'specificDuty',
              'compoundDuty',
              'mpf',
              'hmf',
              'excise',
              'unknown',
            ],
          },
          sourceRateText: { type: ['string', 'null'] },
          formulaText: { type: ['string', 'null'] },
          formulaAst: { type: ['object', 'null'] },
          conditionAst: { type: ['object', 'null'] },
          unitDimensions: { type: ['object', 'null'] },
          constraints: { type: 'array', items: { type: 'object' } },
          roundingPolicy: { type: ['object', 'null'] },
          citations: { type: 'array', items: { type: 'object' } },
          testVectors: { type: 'array', items: { type: 'object' } },
          assumptions: { type: 'array', items: { type: 'string' } },
          blockers: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasonCodes: { type: 'array', items: { type: 'string' } },
    needsJudge: { type: 'boolean' },
  },
} as const;

export const formulaJudgeOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'judgeVerdict',
    'selectedArtifact',
    'corrections',
    'citationsUsed',
    'riskLevel',
    'humanReviewRequired',
    'skillFeedback',
  ],
  properties: {
    judgeVerdict: {
      enum: [
        'codex_correct',
        'qwen_correct',
        'both_equivalent',
        'neither_correct',
        'insufficient_evidence',
        'needs_human_review',
      ],
    },
    selectedArtifact: { type: ['object', 'null'] },
    corrections: { type: 'array', items: { type: 'object' } },
    citationsUsed: { type: 'array', items: { type: 'object' } },
    riskLevel: { enum: ['P1', 'P2', 'P3'] },
    humanReviewRequired: { type: 'boolean' },
    skillFeedback: { type: 'array', items: { type: 'object' } },
  },
} as const;
