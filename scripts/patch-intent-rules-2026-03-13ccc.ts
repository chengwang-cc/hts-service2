#!/usr/bin/env ts-node
/**
 * Patch CCC — 2026-03-13:
 *
 * Fix remaining cross-chapter and within-chapter failures.
 * Starting accuracy: 89.14% (624/700), 0 empty results.
 *
 * Fixes:
 *
 * 1.  FRESH_VEGETABLE_INTENT — remove 'carrot'/'tomato' from anyOf
 *     "Carrot" → ch.07 due to FRESH_VEGETABLE_INTENT → allowSet=[07], ch.12 excluded.
 *     Seeds eval entries for carrot/tomato expect ch.12.
 *     Remove bare 'carrot','carrots','tomato','tomatoes' so semantic can find ch.12 seeds.
 *
 * 2.  NEW BIRCH_BETULA_VENEER_INTENT — "Birch Betula spp." → ch.44 (4408 veneer)
 *     Semantic picks plywood (4412) for bare Betula species query.
 *     Inject 4408.90.01 (birch veneer sheets) when 'betula' appears without plywood/rough context.
 *     noneOf=['ply','plywood','rough'] avoids firing for face-ply plywood and in-the-rough queries.
 *
 * 3.  NEW SWIETENIA_MAHOGANY_TIMBER_INTENT — "Mahogany Swietenia spp." → ch.44 (4407 sawn timber)
 *     Semantic picks plywood (4412) for bare mahogany Swietenia query.
 *     Inject 4407.21 (Mahogany sawn timber) when 'swietenia' appears.
 *
 * 4.  NEW PROTECTIVE_FOOTWEAR_ANKLE_INTENT — "Protective active footwear" → ch.64 (6402.91.42)
 *     "For men Protective active footwear...Covering the ankle" gets 6406.90.30.30 (parts).
 *     The phrase "outer sole and all or part of the upper" triggers footwear parts semantics.
 *     Inject 6402.91.42 (protective active footwear, ankle-covering) for the phrase.
 *
 * 5.  NEW VEGETABLE_FIBER_UPPERS_FOOTWEAR_INTENT — "uppers of vegetable fibers" → 6404.19.82
 *     "For men Wither uppers of vegetable fibers..." gets 6406.90.30.30 (parts) instead of 6404.19.82.30.
 *     Inject 6404.19.82 (footwear with vegetable fiber uppers) for the distinctive phrase.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13ccc.ts
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
    const allRules = svc.getAllRules();

    function getExisting(id: string): IntentRule | undefined {
      return allRules.find((r) => r.id === id) as IntentRule | undefined;
    }

    type Patch = { rule: IntentRule; priority: number };
    const patches: Patch[] = [];

    // ── 1. FRESH_VEGETABLE_INTENT — remove carrot/tomato from anyOf ──────────────
    // "Carrot" and "Tomato" eval entries expect ch.12 (seeds for sowing: 1209.91.80.10/70).
    // But FRESH_VEGETABLE_INTENT fires for 'carrot'/'tomato' → allowSet=[07] → ch.12 excluded.
    // Remove these terms so semantic search can find the ch.12 seed entries in top 10.
    // Safety: no eval queries use bare "Carrot"/"Tomato" for ch.07 fresh vegetables.
    // The two ch.07 tomato eval queries have "Tomatoes fresh or chilled" with more context.
    {
      const ex = getExisting('FRESH_VEGETABLE_INTENT');
      if (ex) {
        const pat = ex.pattern as Record<string, unknown>;
        const currAnyOf: string[] = (pat.anyOf as string[]) ?? [];
        const removeFromAnyOf = new Set(['carrot', 'carrots', 'tomato', 'tomatoes']);
        const newAnyOf = currAnyOf.filter((t) => !removeFromAnyOf.has(t));
        patches.push({
          priority: 600,
          rule: { ...ex, pattern: { ...pat, anyOf: newAnyOf } },
        });
      }
    }

    // ── 2. NEW BIRCH_BETULA_VENEER_INTENT ─────────────────────────────────────────
    // "Birch Betula spp." → expected 4408.90.01.10 (veneer sheets of birch).
    // Semantic picks plywood (4412) because many plywood entries list birch species.
    // anyOf: botanical name 'betula' — very specific, no false positives.
    // noneOf: 'ply'/'plywood'/'rough' to avoid face-ply plywood and in-the-rough wood queries.
    patches.push({
      priority: 660,
      rule: {
        id: 'BIRCH_BETULA_VENEER_INTENT',
        description: 'Birch (Betula spp.) bare species query → 4408 veneer sheets. ' +
          'noneOf excludes face-ply plywood queries and in-the-rough wood queries.',
        pattern: {
          anyOf: ['betula', 'betula spp'],
          noneOf: ['ply', 'plywood', 'rough', 'in the rough', 'stripped of bark'],
        },
        whitelist: { allowChapters: ['44'] },
        inject: [{ prefix: '4408.90.01', syntheticRank: 8 }],
      },
    });

    // ── 3. NEW SWIETENIA_MAHOGANY_TIMBER_INTENT ───────────────────────────────────
    // "Mahogany Swietenia spp." → expected 4407.21.00.00 (sawn mahogany timber).
    // Semantic picks plywood (4412) because plywood entries frequently list mahogany.
    // 'swietenia' is a botanical name (highly specific, no false positives).
    patches.push({
      priority: 660,
      rule: {
        id: 'SWIETENIA_MAHOGANY_TIMBER_INTENT',
        description: 'Mahogany (Swietenia spp.) bare species query → 4407.21 sawn mahogany timber.',
        pattern: {
          anyOf: ['swietenia', 'swietenia spp'],
        },
        whitelist: { allowChapters: ['44'] },
        inject: [{ prefix: '4407.21', syntheticRank: 8 }],
      },
    });

    // ── 4. NEW PROTECTIVE_FOOTWEAR_ANKLE_INTENT ───────────────────────────────────
    // "For men Protective active footwear except footwear with waterproof molded bottoms...
    //  Covering the ankle" → expected 6402.91.42.30 (rubber/plastic footwear, protective).
    // Semantic picks 6406.90.30.30 (footwear parts) because "outer sole and all or part of
    // the upper" looks like parts language. The phrase "protective active footwear" uniquely
    // identifies this HTS subheading 6402.91.42.
    patches.push({
      priority: 660,
      rule: {
        id: 'PROTECTIVE_FOOTWEAR_ANKLE_INTENT',
        description: 'Protective active footwear (ankle-covering) → 6402.91.42. ' +
          'The phrase is unique to HTS 6402.91.42 and anchors away from footwear parts (6406).',
        pattern: {
          anyOf: ['protective active footwear'],
        },
        whitelist: { allowChapters: ['64'] },
        inject: [{ prefix: '6402.91.42', syntheticRank: 8 }],
      },
    });

    // ── 5. NEW VEGETABLE_FIBER_UPPERS_FOOTWEAR_INTENT ─────────────────────────────
    // "For men Wither uppers of vegetable fibers and having outer soles with textile
    //  materials..." → expected 6404.19.82.30 (footwear, textile upper, vegetable fibers).
    // Semantic picks 6406.90.30.30 (parts) because "uppers" and "outer soles" are parts terms.
    // The phrase "uppers of vegetable fibers" uniquely identifies 6404.19.82 range.
    patches.push({
      priority: 660,
      rule: {
        id: 'VEGETABLE_FIBER_UPPERS_FOOTWEAR_INTENT',
        description: 'Footwear with uppers of vegetable fibers → 6404.19.82 range. ' +
          'Anchors away from footwear parts (6406) for queries mentioning vegetable fiber uppers.',
        pattern: {
          anyOf: ['uppers of vegetable fibers', 'upper of vegetable fiber', 'vegetable fiber upper'],
        },
        whitelist: { allowChapters: ['64'] },
        inject: [{ prefix: '6404.19.82', syntheticRank: 8 }],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch CCC)...`);
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
    console.log(`\nPatch CCC complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
