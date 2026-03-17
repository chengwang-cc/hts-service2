#!/usr/bin/env ts-node
/**
 * Patch XXXX — 2026-03-13:
 *
 * Fix COTTON_APPAREL inject: "50% polyester 38% cotton 12% rayon t-shirt" → EMPTY
 *
 * Problem: "t-shirt" (with hyphen) tokenizes to ['t','shirt'] where 't' is filtered
 * (length < 2). So TSHIRT_INTENT (anyOf=['tshirt','tshirts']) doesn't fire.
 * COTTON_APPAREL fires (requires 'cotton', anyOf=['shirt',...]) but has no inject.
 * Without inject, scoring produces EMPTY for complex multi-word cotton garment queries.
 *
 * Fix 1: Add inject + boosts to COTTON_APPAREL so t-shirt results always appear.
 *
 * Fix 2: Add 'shirt'/'shirts' to TSHIRT_INTENT's anyOf as a secondary match.
 *         Use anyOfGroups to require either ('tshirt'/'tshirts') OR
 *         ('shirt'/'shirts' WITH a non-pants context) — but pattern matching
 *         doesn't support this natively.
 *         Instead, add inject directly to COTTON_APPAREL and a new SHIRT_GARMENT_INTENT.
 *
 * Fix 3: NEW SHIRT_GARMENT_INTENT — fires when 'shirt' token is in query
 *         without 'cotton' requirement. Adds inject for 6109/6205 codes.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13xxxx.ts
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

    // ── 1. COTTON_APPAREL: add inject + boosts ────────────────────────────────
    // "50% polyester 38% cotton 12% rayon t-shirt" → COTTON_APPAREL fires on
    // 'cotton' (required) + 'shirt' (anyOf). No inject → EMPTY for complex queries.
    {
      const existing = allRules.find(r => r.id === 'COTTON_APPAREL') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 5,
          rule: {
            ...existing,
            description: (existing.description ?? 'COTTON_APPAREL') +
              ' — Fixed XXXX: added inject/boosts for 6109/6110 to prevent EMPTY on complex cotton garment queries.',
            inject: [
              { prefix: '6109.10.00', syntheticRank: 9 }, // Cotton knit t-shirts
              { prefix: '6110.20.20', syntheticRank: 8 }, // Cotton knit sweaters/sweatshirts
              { prefix: '6205.20.00', syntheticRank: 7 }, // Cotton woven shirts (men's)
            ],
            boosts: [
              { delta: 0.4, prefixMatch: '6109' },
              { delta: 0.3, prefixMatch: '6110' },
              { delta: 0.2, prefixMatch: '6205' },
            ],
          },
        });
        console.log('COTTON_APPAREL: adding inject + boosts for 6109/6110/6205');
      } else {
        console.log('WARNING: COTTON_APPAREL not found');
      }
    }

    // ── 2. NEW SHIRT_GARMENT_INTENT ───────────────────────────────────────────
    // When query has 'shirt' (from "t-shirt" with hyphen → tokenizes as 'shirt')
    // but NOT 'cotton' (so COTTON_APPAREL doesn't fire), still need inject for garment.
    // "50% polyester 38% cotton 12% rayon t-shirt" → COTTON_APPAREL fires (has cotton)
    // "rayon t-shirt", "silk t-shirt", "bamboo t-shirt" → TSHIRT_INTENT fires (has tshirt token if no hyphen)
    // Edge case: "50% rayon 50% polyester t-shirt" → 'shirt' token, no 'cotton', 'tshirt' if unhyphenated
    // This rule catches queries with 'shirt' token as backup.
    patches.push({
      priority: 4,
      rule: {
        id: 'SHIRT_GARMENT_BACKUP_INTENT',
        description: 'Backup inject for shirt-type garment queries → 6109/6205 (ch.61/62). ' +
          'Handles "t-shirt" (hyphenated → tokenizes to \'shirt\', not \'tshirt\'). ' +
          'Without this, complex garment queries like "50% polyester rayon t-shirt" → EMPTY.',
        pattern: {
          anyOf: ['shirt', 'shirts', 'tshirt', 'tshirts'],
          noneOf: [
            // Exclude non-garment shirts
            'dress shirt collar', 'business shirt', 'button down',
            // Exclude hair-shirt (religious)
            'hair shirt', 'hairshirt',
            // Exclude t-shirt PRINTER/PRESSING (ch.84)
            'heat press', 'iron on', 'transfer',
          ],
        },
        whitelist: {
          denyNonAllowedUnlessEntryHasTokens: {
            allowedChapters: ['61', '62'],
            tokens: ['shirt', 'shirts', 'tshirt', 'tshirts', 'tee', 'blouse', 'singlet'],
          },
        },
        inject: [
          { prefix: '6109.10.00', syntheticRank: 9 }, // Cotton knit t-shirts
          { prefix: '6109.90.10', syntheticRank: 8 }, // MMF knit t-shirts
          { prefix: '6109.90.90', syntheticRank: 7 }, // Other fiber knit t-shirts
          { prefix: '6205.20.00', syntheticRank: 6 }, // Cotton woven shirts
          { prefix: '6205.90.50', syntheticRank: 5 }, // Other woven shirts
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '6109' },
          { delta: 0.3, prefixMatch: '6205' },
          { delta: 0.2, prefixMatch: '6206' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch XXXX)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await (svc as any).upsertRule(rule, priority, true);
        console.log(`  ✅ ${(rule as any).id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${(rule as any).id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch XXXX complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
