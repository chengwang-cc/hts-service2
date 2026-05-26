/**
 * Exception-rules core types (Phase 1, P1.T2).
 *
 * The exception-rule engine sits between the base resolver/adapter output
 * and the calculator's roll-up step. Every country-scoped trade-remedy or
 * tax exception (Section 232 metal splits, Section 301 lists, IEEPA
 * reciprocal, AU LCT, EU CBAM, …) is a typed `ExceptionRule` registered
 * with the `ExceptionRuleRegistry` and applied by the
 * `ExceptionRuleRunnerService`.
 *
 * Design contract: see
 *   docs/2026-05-26/1525_calculator-v2-exception-rule-engine-design.md
 *   docs/2026-05-26/1620_calculator-v2-exception-rule-engine-execution-plan.md
 *
 * This file intentionally has no runtime dependencies on NestJS so it can
 * be imported anywhere — including from unit tests that mock the registry.
 */
import type {
  ProgramFamily,
  TariffFormulaComponent,
} from '../calculator/services/tariff-types';

export type { ProgramFamily, TariffFormulaComponent };

/**
 * Per-line context passed to every rule's `isApplicable()` and `evaluate()`.
 *
 * `baseComponents` is the resolver/adapter output **before** any rule has
 * applied. Rules see the same baseline regardless of run order — what
 * actually gets passed to the next rule is the running aggregate, tracked
 * by the runner, not the rule.
 */
export interface ExceptionRuleContext {
  htsCode: string;
  origin: string;
  destination: string;
  /**
   * EU-only legacy field. New rules should read `destinationSubdivision`
   * instead — it generalizes to BR state codes, IN state codes, etc.
   * Populated identically with `destinationSubdivision` by the runner;
   * kept as an alias for backwards compatibility through Wave 3.
   * @deprecated since W0.5.T2 (2026-05-26). Use `destinationSubdivision`.
   */
  destinationMemberState?: string;
  /**
   * W0.5.T2 (2026-05-26): destination subdivision — EU member state,
   * BR state, IN state, US state, CA province, etc. Generalizes the
   * EU-only `destinationMemberState` for the 11-country expansion.
   * Both fields are populated identically by the runner.
   */
  destinationSubdivision?: string;
  /** Per-quote evaluation date; defaults to "now" if not supplied. */
  asOfDate: Date;
  declaredValue: number;
  currency: string;
  additionalInputs: Record<string, unknown>;
  baseComponents: TariffFormulaComponent[];
  /** Components produced by rules that already fired this run. */
  pendingComponents: TariffFormulaComponent[];
  /** IDs of rules that already fired this run, in fire order. */
  firedRules: string[];
  /** Best-known FX rate at evaluation time (1 when same currency). */
  fxRate?: number;
}

/**
 * Outcome of a rule's `evaluate()`. All three operations are optional and
 * applied in this order:
 *   1. `removeKeys` — drop existing components by stable key (see
 *      `componentKey()` in the runner).
 *   2. `replace` — for each entry, find the component matching `key` and
 *      swap its content with `with`. No-op when no match.
 *   3. `add` — append new components to the running list.
 *
 * `conflictsWith` is checked by the runner *before* calling `evaluate()`,
 * not after — it's a static declaration on the rule (see
 * `ExceptionRule.conflictsWith`) and not re-emitted here.
 *
 * `requiredInputs` is mainly surfaced via `declaredInputs()` at the rule
 * level; including it on a decision is optional and used when a rule
 * wants to dynamically demand additional inputs based on the current
 * `additionalInputs` shape (rare).
 */
export interface ExceptionRuleDecision {
  add?: TariffFormulaComponent[];
  removeKeys?: string[];
  replace?: Array<{ key: string; with: TariffFormulaComponent }>;
  requiredInputs?: ExceptionRuleInputSpec[];
  /** Free-text notes for the audit snapshot — not user-facing. */
  notes?: string[];
  /**
   * C2/C3 (2026-05-26): structured per-rule payload. Lets downstream
   * consumers (e.g., the CBAM persistence pass) read typed values
   * from the rule's evaluate without parsing notes via regex.
   *
   * Convention: keys are stable identifiers the rule documents in its
   * docstring (e.g., CBAM emits `sector`, `cbamCertificates`,
   * `provisionalCostEur`, `defaultApplied`).
   */
  data?: Record<string, unknown>;
}

export type ExceptionRuleInputType =
  | 'country'
  | 'enum'
  | 'percent'
  | 'money'
  | 'int'
  | 'number'
  | 'boolean'
  | 'text';

export interface ExceptionRuleInputSpec {
  name: string;
  type: ExceptionRuleInputType;
  required: boolean;
  label: string;
  /** Knowledge-card pointer for the in-form help affordance. */
  helpRef?: string;
  /**
   * Either a concrete list of values (for enum/country) or a shorthand
   * range string (`'[0,100]'` for percent, `'ISO3166-A2 ∪ {UN}'`, etc.).
   * Validation lives on the consuming form; the spec is descriptive.
   */
  allowedValues?: string[] | string;
  /**
   * Pure function on the current input bag; FE evaluates this to decide
   * whether to render the input. Optional — defaults to "always visible".
   *
   * Carries no closure / state — must be pure and stateless.
   */
  visibleWhen?: (inputs: Record<string, unknown>) => boolean;
}

/**
 * The interface every concrete rule implements.
 *
 * Implementation guidance:
 *   - `isApplicable()` MUST be cheap (no I/O, no DB). The runner calls it
 *     for every (line × rule). Heavy work belongs in `evaluate()`.
 *   - `evaluate()` is only called when `isApplicable()` returned true.
 *   - `declaredInputs()` is the single source of truth for what the form
 *     should render; it's called by `/v2/formula` to compose the union
 *     of all applicable rules' inputs.
 *   - `knowledgeCardKeys` is the join to the knowledge library; the
 *     review-alert loop (Phase 8) uses it to notify when source documents
 *     change.
 *
 * Identifier discipline: `id` is permanent. Once shipped, never rename;
 * supersede with a new id and disable the old via `rule_status`.
 */
export interface ExceptionRule {
  readonly id: string;
  readonly destination: string;
  readonly authority: ProgramFamily;
  readonly title: string;
  /** Lower number runs first. Use the bands from design doc §3.4. */
  readonly priority: number;
  readonly knowledgeCardKeys: string[];
  /** Rule IDs that must NOT have already fired this run. */
  readonly conflictsWith?: string[];

  isApplicable(ctx: ExceptionRuleContext): boolean;
  /**
   * Sync or async — the runner awaits either. Sync is the common case
   * (data-driven rules with in-memory lookups); async exists for rules
   * that hit the DB (AD/CVD, Phase 9) or external services.
   */
  evaluate(ctx: ExceptionRuleContext): ExceptionRuleDecision | Promise<ExceptionRuleDecision>;
  declaredInputs(): ExceptionRuleInputSpec[];
}

/**
 * Result of running the registry against one line. Carried in audit so
 * "why was this quote priced this way" replays correctly.
 */
export interface ExceptionRuleRunResult {
  /** Final component list after every applicable+enabled rule applied. */
  components: TariffFormulaComponent[];
  /** IDs of rules that actually fired (in order). */
  firedRules: string[];
  /** Rules that were applicable + enabled but short-circuited by a
   * `conflictsWith` declaration of an already-fired rule. */
  skippedByConflict: string[];
  /** Per-rule notes returned by `evaluate()`, keyed by rule id. */
  notes: Record<string, string[]>;
  /**
   * C2/C3 fix (2026-05-26): per-rule structured payload returned by
   * `evaluate()`, keyed by rule id. Lets the quote service consume
   * rule-specific outputs (e.g., the CBAM rule's certificate count +
   * defaultApplied flag) without parsing rule notes via regex.
   *
   * Only populated when a rule's `decision.data` is set. Optional so
   * existing rules that don't return data stay forward-compatible.
   */
  data?: Record<string, Record<string, unknown>>;
}

/**
 * Public summary of a registered rule, for the admin endpoint.
 */
export interface ExceptionRuleSummary {
  id: string;
  destination: string;
  authority: ProgramFamily;
  title: string;
  priority: number;
  enabled: boolean;
  knowledgeCardKeys: string[];
  conflictsWith: string[];
}
