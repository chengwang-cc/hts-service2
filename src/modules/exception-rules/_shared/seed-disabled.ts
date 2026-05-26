import { Logger } from '@nestjs/common';
import { ExceptionRuleRegistry } from '../exception-rule.registry';
import { RuleStatusService, RuleStatusSummary } from '../rule-status.service';
import type { ExceptionRule } from '../types';

/**
 * H9 fix (2026-05-27): shared module-init helper that batches the
 * "register every rule + seed missing rule_status rows" pattern into a
 * single `status.list()` call per country module, instead of one call
 * per rule. With 52 rules across 9 modules this drops boot-time DB
 * round-trips from ~52 to ~9.
 *
 * Best-effort throughout — per-rule registration / seeding failures
 * log a warning and continue; the boot path is never blocked.
 */
export async function registerAndSeedDisabled(args: {
  registry: ExceptionRuleRegistry;
  status: RuleStatusService;
  logger: Logger;
  moduleLabel: string;
  rules: ExceptionRule[];
}): Promise<void> {
  const { registry, status, logger, moduleLabel, rules } = args;

  // Register all rules first — purely in-memory, no DB.
  for (const rule of rules) {
    try {
      registry.register(rule);
    } catch (e: any) {
      logger.warn(`registration skipped for ${rule.id}: ${e?.message ?? e}`);
    }
  }

  // Single DB read for the status snapshot.
  let existing: RuleStatusSummary[] = [];
  try {
    existing = await status.list();
  } catch (e: any) {
    logger.warn(
      `${moduleLabel}: rule_status snapshot failed (${e?.message ?? e}); ` +
        `skipping seeding — rules remain in-memory and default to enabled until DB recovers`,
    );
    return;
  }
  const existingIds = new Set(existing.map((s) => s.ruleId));

  // Single write per rule that needs seeding.
  for (const rule of rules) {
    if (existingIds.has(rule.id)) continue;
    try {
      await status.set({
        ruleId: rule.id,
        enabled: false,
        reason: `Seeded as disabled by ${moduleLabel}.onModuleInit().`,
        changedBy: `system:${moduleLabel}`,
      });
    } catch (e: any) {
      logger.warn(`rule_status seed skipped for ${rule.id}: ${e?.message ?? e}`);
    }
  }

  logger.log(`${moduleLabel}: registered ${rules.length} rule(s); disabled by default`);
}
