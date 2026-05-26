import { Injectable, Logger } from '@nestjs/common';
import type { ExceptionRule } from './types';

/**
 * ExceptionRuleRegistry (Phase 1, P1.T3).
 *
 * DI singleton holding the in-memory list of registered rules, sorted by
 * `priority` (low → high). Each rule registers once at module init; the
 * registry rejects duplicate `id`s loudly because silent overwrite would
 * cause hard-to-debug behavior drift.
 *
 * The registry does not consult `RuleStatusService` — `enabled` is a
 * runtime concern handled by the runner. Tests can read the full list
 * via `all()` for assertions; the admin endpoint queries `summaries()`.
 *
 * Stability guarantee: registration order is preserved among rules with
 * equal `priority`. This matters because some priority bands hold many
 * sibling rules (e.g. §301 lists 1–4A) and stable order keeps the
 * audit snapshot reproducible.
 */
@Injectable()
export class ExceptionRuleRegistry {
  private readonly logger = new Logger(ExceptionRuleRegistry.name);
  private readonly rules: ExceptionRule[] = [];
  private readonly ids = new Set<string>();
  /** cardKey → ExceptionRule[] reverse index (built lazily). */
  private reverseIndexCache: Map<string, ExceptionRule[]> | null = null;

  /**
   * Register a rule. Throws if `id` is already registered.
   *
   * Stable-insert-by-priority — uses a linear scan because the count is
   * small (≤ ~100 rules across all destinations).
   */
  register(rule: ExceptionRule): void {
    if (this.ids.has(rule.id)) {
      throw new Error(
        `ExceptionRuleRegistry: duplicate rule id "${rule.id}"`,
      );
    }
    this.ids.add(rule.id);
    const insertAt = this.rules.findIndex((r) => r.priority > rule.priority);
    if (insertAt < 0) this.rules.push(rule);
    else this.rules.splice(insertAt, 0, rule);
    this.reverseIndexCache = null;
    this.logger.debug(
      `registered rule "${rule.id}" (${rule.destination}, priority=${rule.priority})`,
    );
  }

  /**
   * Rules registered for a given destination, in priority order.
   * Case-insensitive destination match.
   */
  rulesFor(destination: string): ExceptionRule[] {
    const d = (destination || '').toUpperCase();
    return this.rules.filter((r) => r.destination.toUpperCase() === d);
  }

  /** All registered rules, in priority order. Used by the admin endpoint. */
  all(): ExceptionRule[] {
    return this.rules.slice();
  }

  /** Lookup by id, or undefined when absent. */
  get(id: string): ExceptionRule | undefined {
    return this.rules.find((r) => r.id === id);
  }

  /** Number of registered rules. */
  size(): number {
    return this.rules.length;
  }

  /**
   * Reverse index `cardKey → rules`. Recomputed when registrations
   * change. Phase 8 (`RuleReviewAlertService`) consumes this.
   */
  rulesForCard(cardKey: string): ExceptionRule[] {
    if (!this.reverseIndexCache) {
      const idx = new Map<string, ExceptionRule[]>();
      for (const r of this.rules) {
        for (const k of r.knowledgeCardKeys) {
          const bucket = idx.get(k) ?? [];
          bucket.push(r);
          idx.set(k, bucket);
        }
      }
      this.reverseIndexCache = idx;
    }
    return this.reverseIndexCache.get(cardKey) ?? [];
  }
}
