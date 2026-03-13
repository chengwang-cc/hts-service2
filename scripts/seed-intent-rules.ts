#!/usr/bin/env ts-node
/**
 * Seed all IntentRules from the static INTENT_RULES array into the
 * lookup_intent_rule Postgres table via IntentRuleService.upsertRule().
 *
 * Run once after the DB migration has been applied:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/seed-intent-rules.ts
 *
 * Safe to re-run — uses upsert keyed on ruleId.
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { INTENT_RULES } from '../src/modules/lookup/services/intent-rules';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function seed(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Seeding ${INTENT_RULES.length} intent rules...`);

    let seeded = 0;
    let failed = 0;

    for (let i = 0; i < INTENT_RULES.length; i++) {
      const rule = INTENT_RULES[i];
      try {
        await svc.upsertRule(rule, i, true);
        seeded++;
        if (seeded % 100 === 0) {
          console.log(`  Progress: ${seeded}/${INTENT_RULES.length}`);
        }
      } catch (err) {
        failed++;
        console.error(`  FAILED rule [${rule.id}]:`, err);
      }
    }

    // Reload the in-memory cache from DB
    await svc.reload();

    console.log(`\nSeed complete.`);
    console.log(`  Seeded:  ${seeded}`);
    console.log(`  Failed:  ${failed}`);
    console.log(`  In cache: ${svc.ruleCount}`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

seed().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
