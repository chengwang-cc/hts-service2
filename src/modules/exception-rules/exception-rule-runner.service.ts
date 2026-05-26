import { Injectable, Logger } from '@nestjs/common';
import { ExceptionRuleRegistry } from './exception-rule.registry';
import { RuleStatusService } from './rule-status.service';
import type {
  ExceptionRule,
  ExceptionRuleContext,
  ExceptionRuleDecision,
  ExceptionRuleRunResult,
  TariffFormulaComponent,
} from './types';

/**
 * ExceptionRuleRunnerService (Phase 1, P1.T6).
 *
 * Composes the base resolver/adapter components with every applicable +
 * enabled exception rule for the destination, in priority order.
 *
 * Algorithm (matches design doc §3.5):
 *
 *   final = baseComponents
 *   firedRules = []
 *   for rule of registry.rulesFor(destination):
 *     if !statusService.isEnabled(rule.id, asOf):                 → skip
 *     ctx.pendingComponents = final
 *     ctx.firedRules        = firedRules
 *     if !rule.isApplicable(ctx):                                  → skip
 *     if rule.conflictsWith ∩ firedRules ≠ ∅:                      → skip + record
 *     decision = rule.evaluate(ctx)
 *     final = apply(final, decision)
 *     firedRules.push(rule.id)
 *   return { components: final, firedRules, ... }
 *
 * Phase 1 ships with an empty registry → this is a transparent
 * pass-through; the baseline regression test guards that.
 */
@Injectable()
export class ExceptionRuleRunnerService {
  private readonly logger = new Logger(ExceptionRuleRunnerService.name);

  constructor(
    private readonly registry: ExceptionRuleRegistry,
    private readonly status: RuleStatusService,
  ) {}

  async run(args: {
    htsCode: string;
    origin: string;
    destination: string;
    /** @deprecated W0.5.T2 — use `destinationSubdivision`. Both accepted. */
    destinationMemberState?: string;
    destinationSubdivision?: string;
    asOfDate?: Date;
    declaredValue: number;
    currency: string;
    additionalInputs?: Record<string, unknown>;
    baseComponents: TariffFormulaComponent[];
    fxRate?: number;
  }): Promise<ExceptionRuleRunResult> {
    const asOfDate = args.asOfDate ?? new Date();
    const candidates = this.registry.rulesFor(args.destination);
    if (candidates.length === 0) {
      return {
        components: args.baseComponents.slice(),
        firedRules: [],
        skippedByConflict: [],
        notes: {},
      };
    }

    let components = args.baseComponents.slice();
    const firedRules: string[] = [];
    const skippedByConflict: string[] = [];
    const notes: Record<string, string[]> = {};
    const data: Record<string, Record<string, unknown>> = {};

    for (const rule of candidates) {
      const enabled = await this.status.isEnabled(rule.id, asOfDate);
      if (!enabled) continue;

      // W0.5.T2 (2026-05-26): populate both `destinationMemberState`
      // (legacy EU field) and `destinationSubdivision` (general) from
      // whichever arg the caller supplied. New rules read subdivision;
      // existing EU rules keep reading memberState.
      const subdivision =
        args.destinationSubdivision ?? args.destinationMemberState;
      const ctx: ExceptionRuleContext = {
        htsCode: args.htsCode,
        origin: args.origin,
        destination: args.destination,
        destinationMemberState: subdivision,
        destinationSubdivision: subdivision,
        asOfDate,
        declaredValue: args.declaredValue,
        currency: args.currency,
        additionalInputs: args.additionalInputs ?? {},
        baseComponents: args.baseComponents,
        pendingComponents: components,
        firedRules: firedRules.slice(),
        fxRate: args.fxRate,
      };

      let applicable: boolean;
      try {
        applicable = rule.isApplicable(ctx);
      } catch (e: any) {
        this.logger.warn(
          `rule "${rule.id}" isApplicable threw: ${e?.message ?? e}`,
        );
        continue;
      }
      if (!applicable) continue;

      const conflict = rule.conflictsWith?.find((id) => firedRules.includes(id));
      if (conflict) {
        skippedByConflict.push(rule.id);
        this.logger.debug(
          `rule "${rule.id}" skipped: conflicts with already-fired "${conflict}"`,
        );
        continue;
      }

      let decision: ExceptionRuleDecision;
      try {
        // Rules may return either ExceptionRuleDecision OR a Promise of
        // one. Async is needed for AD/CVD (DB lookups) and the AI
        // council advisory hook; sync remains the common case.
        //
        // H4 fix (2026-05-26): wrap async evaluates in a deadline so a
        // hung DB/IO call can't stall the whole quote. The timeout is
        // generous (5s default, configurable) — only catches genuine
        // hangs, not slow-but-progressing calls.
        decision = await this.evaluateWithTimeout(rule, ctx);
      } catch (e: any) {
        this.logger.error(
          `rule "${rule.id}" evaluate threw: ${e?.message ?? e}`,
        );
        // Fail-safe: drop the rule's contribution, continue with the rest.
        continue;
      }

      components = applyDecision(components, decision);
      // Only record this rule as "fired" when its decision changed the
      // component list. A pure-notes / pure-deferral decision (e.g.
      // steel-melt-pour returning `{}` for RU origin so steel-russia
      // can take over) MUST NOT block conflictsWith-based successors.
      // See Defect 4 in 2026-05-27 deep code review.
      const hadEffect =
        (decision.add?.length ?? 0) > 0 ||
        (decision.removeKeys?.length ?? 0) > 0 ||
        (decision.replace?.length ?? 0) > 0;
      if (hadEffect) firedRules.push(rule.id);
      if (decision.notes && decision.notes.length > 0) {
        notes[rule.id] = decision.notes;
      }
      if (
        decision.data &&
        typeof decision.data === 'object' &&
        Object.keys(decision.data).length > 0
      ) {
        data[rule.id] = decision.data as Record<string, unknown>;
      }
    }

    return { components, firedRules, skippedByConflict, notes, data };
  }

  /**
   * H4 fix (2026-05-26): race the rule's `evaluate` against a deadline
   * so a hung async rule (slow DB, deadlocked lock, mis-configured
   * external service) doesn't stall the whole quote.
   *
   * For synchronous rules the timeout is a no-op — the result resolves
   * before the timer fires. For async rules the deadline defaults to
   * 5s; override per-deployment via `EXCEPTION_RULE_TIMEOUT_MS`.
   *
   * On timeout we throw an Error the outer `try/catch` swallows, so
   * the rule's contribution is dropped and the rest of the engine
   * continues.
   */
  private async evaluateWithTimeout(
    rule: ExceptionRule,
    ctx: ExceptionRuleContext,
  ): Promise<ExceptionRuleDecision> {
    const timeoutMs = Number(process.env.EXCEPTION_RULE_TIMEOUT_MS ?? 5000);
    const raw = rule.evaluate(ctx);
    if (!(raw instanceof Promise)) return raw;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race<ExceptionRuleDecision>([
        raw,
        new Promise<ExceptionRuleDecision>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`rule "${rule.id}" timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Stable key for a component, used by `removeKeys` and `replace`.
 *
 * Key shape: `${programFamily}|${chapter99HtsCode ?? '-'}|${identifier ?? '-'}`.
 * The choice deliberately avoids `formula` (which is content) and
 * `rateLabel` (which is display) so rule-emitted swaps still match
 * after the resolver's wording changes.
 *
 * Exported so rules and tests can build keys consistently.
 */
export function componentKey(c: TariffFormulaComponent): string {
  return `${c.programFamily ?? c.componentType}|${c.chapter99HtsCode ?? '-'}|${c.identifier ?? '-'}`;
}

/**
 * Pure transformation. Order is: removeKeys → replace → add. Components
 * not matched by any operation pass through unchanged.
 */
export function applyDecision(
  components: TariffFormulaComponent[],
  decision: ExceptionRuleDecision,
): TariffFormulaComponent[] {
  let out = components.slice();

  if (decision.removeKeys && decision.removeKeys.length > 0) {
    const toRemove = new Set(decision.removeKeys);
    out = out.filter((c) => !toRemove.has(componentKey(c)));
  }

  if (decision.replace && decision.replace.length > 0) {
    for (const { key, with: replacement } of decision.replace) {
      const i = out.findIndex((c) => componentKey(c) === key);
      if (i >= 0) out[i] = replacement;
    }
  }

  if (decision.add && decision.add.length > 0) {
    out = out.concat(decision.add);
  }

  return out;
}
