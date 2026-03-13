#!/usr/bin/env ts-node
/**
 * Patch MMM — 2026-03-13:
 *
 * Fix bug in LLL:
 *
 * FIX EXPOSED_NOT_DEVELOPED_PHOTOGRAPHIC_INTENT — remove 'developed' from noneOf
 *     Target query: "Photographic plates film paper...exposed but not developed"
 *     Has token 'developed' (from "but not developed") → noneOf was blocking it.
 *     The anyOf phrase "exposed but not developed" already uniquely identifies the target.
 *     No need to exclude 'developed' since queries about developed materials won't
 *     say "exposed but not developed".
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13mmm.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });
    const allRules = svc.getAllRules() as IntentRule[];

    type Patch = { rule: IntentRule; priority: number };
    const patches: Patch[] = [];

    // FIX EXPOSED_NOT_DEVELOPED_PHOTOGRAPHIC_INTENT
    {
      const existing = allRules.find(r => r.id === 'EXPOSED_NOT_DEVELOPED_PHOTOGRAPHIC_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        // Remove 'developed' from noneOf — target query has token 'developed' in "not developed"
        const newNoneOf = (pat.noneOf ?? []).filter((t: string) => t !== 'developed');
        patches.push({
          priority: 660,
          rule: {
            ...existing,
            description: 'Exposed but not developed photographic materials → 3704 (ch.37). ' +
              'Removed "developed" from noneOf — target query has "not developed" containing the token.',
            pattern: {
              ...pat,
              noneOf: newNoneOf,
            },
          },
        });
        console.log(`noneOf was: ${JSON.stringify(pat.noneOf)}`);
        console.log(`noneOf now: ${JSON.stringify(newNoneOf)}`);
      } else {
        console.log('EXPOSED_NOT_DEVELOPED_PHOTOGRAPHIC_INTENT not found — creating fresh');
        patches.push({
          priority: 660,
          rule: {
            id: 'EXPOSED_NOT_DEVELOPED_PHOTOGRAPHIC_INTENT',
            description: 'Exposed but not developed photographic materials → 3704 (ch.37).',
            pattern: {
              anyOf: ['exposed but not developed', 'exposed not developed'],
              noneOf: ['positive', 'motion picture'],
            },
            whitelist: { allowChapters: ['37'] },
            inject: [{ prefix: '3704.00', syntheticRank: 8 }],
            boosts: [{ delta: 0.6, prefixMatch: '3704.' }],
          },
        });
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch MMM)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority, true);
        console.log(`  ✅ ${rule.id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${rule.id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch MMM complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
