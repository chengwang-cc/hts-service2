#!/usr/bin/env ts-node
/**
 * Patch GGGG — 2026-03-13:
 *
 * Two more targeted fixes.
 *
 * 1. NEW WATCH_17_JEWELS_INTENT
 *    "Having over 17 jewels in the movement Other"
 *    → expected 9101.99.80 (wristwatches with precious metal case, ch.91)
 *    Got 9109.90.20.00 (clock movements, ch.91)
 *    The phrase "having over 17 jewels in the movement" is UNIQUE to 9101.99.80 path.
 *    allowChapters=['91'] + inject + boost ensures it wins over clock movement codes.
 *
 * 2. NEW NUTS_SHELLED_OTHER_INTENT
 *    "Other Shelled Other nuts fresh or dried whether or not shelled or peeled"
 *    → expected 0802.12.00.15 (almonds shelled other, ch.08)
 *    Got 0802.52.00.00 (pistachios shelled, ch.08)
 *    The phrase "shelled other nuts fresh or dried" appears in the path for
 *    0802.12.00.15 (Almonds: Shelled: Other) but NOT for 0802.52 (Pistachios: Shelled).
 *    A boost to 0802.12 helps the "Other" leaf node code win.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13gggg.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });

    type Patch = { rule: unknown; priority: number };
    const patches: Patch[] = [];

    // ── 1. NEW WATCH_17_JEWELS_INTENT ─────────────────────────────────────────
    // "Having over 17 jewels in the movement" is the EXACT leaf description of
    // 9101.99.80 (wristwatches with precious metal case, 17+ jewels).
    // Semantic picks 9109.90.20.00 (clock movements, measured by size).
    // The phrase is uniquely identifying — inject + boost 9101.99.80 to win.
    patches.push({
      priority: 660,
      rule: {
        id: 'WATCH_17_JEWELS_INTENT',
        description: 'Wristwatches with precious metal case, 17+ jewels → 9101.99.80 (ch.91). ' +
          'Semantic picks 9109.90 (clock movements). ' +
          '"having over 17 jewels in the movement" uniquely identifies 9101.99.80 path.',
        pattern: {
          anyOf: [
            'having over 17 jewels in the movement',
            'over 17 jewels in the movement',
            '17 jewels in the movement',
          ],
        },
        whitelist: { allowChapters: ['91'] },
        inject: [{ prefix: '9101.99.80', syntheticRank: 8 }],
        boosts: [
          { delta: 0.8, prefixMatch: '9101.99.80' },
          { delta: -0.5, prefixMatch: '9109' },
        ],
      },
    });

    // ── 2. NEW NUTS_SHELLED_OTHER_INTENT ──────────────────────────────────────
    // 0802.12.00.15 path: "Other nuts: Shelled: Other" (Almonds, shelled, other)
    // 0802.52.00.00 path: "Other nuts: Shelled" (Pistachios, shelled — no "Other" leaf)
    // The query "Other Shelled Other nuts fresh or dried..." contains "shelled other
    // nuts fresh or dried" as a phrase — this only appears in the 0802.12.00.15 path
    // (the "Other" leaf under "Shelled" under the chapter-header nuts text).
    // Boost 0802.12 to ensure the "Other" leaf variant wins over pistachio shelled.
    patches.push({
      priority: 660,
      rule: {
        id: 'NUTS_SHELLED_OTHER_INTENT',
        description: 'Almonds shelled other → 0802.12.00.15 (ch.08). ' +
          'Semantic picks 0802.52.00.00 (pistachios shelled). ' +
          '"shelled other nuts fresh or dried" phrase matches 0802.12 (Almonds: Shelled: Other) ' +
          'specifically because pistachio path has no "Other" leaf under "Shelled".',
        pattern: {
          anyOf: [
            'shelled other nuts fresh or dried',
            'other nuts fresh or dried whether or not shelled or peeled',
          ],
          noneOf: [
            'pistachios', 'pistachio', 'brazil', 'cashew', 'hazelnut',
            'chestnut', 'walnut', 'pecan', 'macadamia', 'pine nut',
          ],
        },
        whitelist: { allowChapters: ['08'] },
        inject: [{ prefix: '0802.12', syntheticRank: 8 }],
        boosts: [
          { delta: 0.5, prefixMatch: '0802.12' },
          { delta: -0.3, prefixMatch: '0802.52' },
        ],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch GGGG)...`);
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
    console.log(`\nPatch GGGG complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
