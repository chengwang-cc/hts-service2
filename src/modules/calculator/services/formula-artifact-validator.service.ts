import { z } from 'zod';

export const FORMULA_ARTIFACT_VALIDATOR_VERSION = 'formula-artifacts-v1';

const FormulaAstNodeSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('constant'),
      value: z.number().finite(),
    }),
    z.object({
      kind: z.literal('variable'),
      name: z.string().min(1),
    }),
    z.object({
      kind: z.literal('operator'),
      op: z.string().min(1),
      args: z.array(FormulaAstNodeSchema).min(1),
    }),
    z.object({
      kind: z.literal('function'),
      name: z.string().min(1),
      args: z.array(FormulaAstNodeSchema),
    }),
    z.object({
      kind: z.literal('raw'),
      expression: z.string(),
    }),
  ]),
);

const ConditionAstNodeSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('always') }),
    z.object({
      kind: z.literal('all'),
      conditions: z.array(ConditionAstNodeSchema).min(1),
    }),
    z.object({
      kind: z.literal('any'),
      conditions: z.array(ConditionAstNodeSchema).min(1),
    }),
    z.object({
      kind: z.literal('not'),
      condition: ConditionAstNodeSchema,
    }),
    z.object({
      kind: z.literal('country_in'),
      countries: z.array(z.string().min(1)).min(1),
    }),
    z.object({
      kind: z.literal('country_not_in'),
      countries: z.array(z.string().min(1)).min(1),
    }),
    z.object({
      kind: z.literal('chapter99_selected'),
      heading: z.string().min(1),
    }),
    z.object({
      kind: z.literal('chapter99_not_selected'),
      heading: z.string().min(1),
    }),
    z.object({
      kind: z.literal('declared_value_min'),
      value: z.number().finite(),
    }),
    z.object({
      kind: z.literal('declared_value_max'),
      value: z.number().finite(),
    }),
    z.object({
      kind: z.literal('trade_agreement'),
      agreement: z.string().min(1),
      requiresCertificate: z.boolean(),
    }),
    z.object({
      kind: z.literal('additional_input_flag'),
      key: z.string().min(1),
      expected: z.boolean(),
    }),
    z.object({
      kind: z.literal('mode_of_transport'),
      mode: z.string().min(1),
    }),
    z.object({
      kind: z.literal('manual_review_required'),
      reason: z.string().optional(),
    }),
    z.object({
      kind: z.literal('requires_chapter99_selection'),
      heading: z.string().min(1),
    }),
    z.object({
      kind: z.literal('requires_certificate'),
      agreement: z.string().min(1),
    }),
    z.object({
      kind: z.literal('pending_policy_review'),
    }),
  ]),
);

const UnitDimensionsSchema = z.record(
  z.string().min(1),
  z.enum(['money', 'weight', 'quantity', 'volume', 'area', 'length']).or(
    z.string().min(1),
  ),
);

const ConstraintsSchema = z
  .object({
    minAmount: z.number().finite().nullable().optional(),
    maxAmount: z.number().finite().nullable().optional(),
    rounding: z.string().min(1).optional(),
  })
  .passthrough();

const RoundingPolicySchema = z
  .object({
    mode: z.enum(['component_2dp', 'defer', 'final_2dp']),
    precision: z.number().int().nonnegative().optional(),
    jurisdictionCode: z.string().min(1).optional(),
  })
  .passthrough();

const TestVectorSchema = z
  .object({
    name: z.string().min(1),
    inputs: z.record(z.string().min(1), z.number().finite()),
    expectedAmount: z.number().finite(),
    tolerance: z.number().finite().nonnegative().optional(),
  })
  .passthrough();

export interface FormulaArtifactValidationInput {
  formulaText?: string | null;
  formulaAst?: unknown;
  conditionAst?: unknown;
  unitDimensions?: unknown;
  constraints?: unknown;
  roundingPolicy?: unknown;
  testVectors?: unknown;
}

export interface FormulaArtifactValidationOptions {
  requireRuntimeArtifacts?: boolean;
  allowRawFormulaAst?: boolean;
}

export interface FormulaArtifactValidationResult {
  valid: boolean;
  errors: string[];
  validatorVersion: string;
}

export function validateFormulaArtifacts(
  input: FormulaArtifactValidationInput,
  options: FormulaArtifactValidationOptions = {},
): FormulaArtifactValidationResult {
  const errors: string[] = [];
  const requireRuntimeArtifacts = !!options.requireRuntimeArtifacts;

  validateValue(
    'formulaAst',
    input.formulaAst,
    FormulaAstNodeSchema,
    errors,
    requireRuntimeArtifacts,
  );
  validateValue(
    'conditionAst',
    input.conditionAst,
    ConditionAstNodeSchema,
    errors,
    requireRuntimeArtifacts,
  );
  validateValue(
    'unitDimensions',
    input.unitDimensions,
    UnitDimensionsSchema,
    errors,
    requireRuntimeArtifacts,
  );
  validateValue(
    'constraints',
    input.constraints,
    ConstraintsSchema,
    errors,
    requireRuntimeArtifacts,
  );
  validateValue(
    'roundingPolicy',
    input.roundingPolicy,
    RoundingPolicySchema,
    errors,
    requireRuntimeArtifacts,
  );
  validateValue(
    'testVectors',
    input.testVectors,
    z.array(TestVectorSchema),
    errors,
    false,
  );

  if (
    !options.allowRawFormulaAst &&
    isRecord(input.formulaAst) &&
    input.formulaAst.kind === 'raw'
  ) {
    errors.push('formulaAst: raw formula AST is not authoritative');
  }

  if (
    typeof input.formulaText === 'string' &&
    input.formulaText.trim().length === 0
  ) {
    errors.push('formulaText: empty formula text');
  }

  return {
    valid: errors.length === 0,
    errors,
    validatorVersion: FORMULA_ARTIFACT_VALIDATOR_VERSION,
  };
}

function validateValue(
  name: string,
  value: unknown,
  schema: z.ZodType,
  errors: string[],
  required: boolean,
): void {
  if (value === null || value === undefined) {
    if (required) {
      errors.push(`${name}: missing required artifact`);
    }
    return;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? `.${issue.path.join('.')}` : '';
      errors.push(`${name}${path}: ${issue.message}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
