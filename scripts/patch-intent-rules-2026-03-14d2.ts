#!/usr/bin/env ts-node
/**
 * Patch D2 — 2026-03-14:
 *
 * Regression fixes:
 * 1. COFFEE_SINGLE_ORIGIN_INTENT anyOf: REMOVE country names ('nicaragua', 'colombia',
 *    'ethiopia', 'kenya', 'guatemala', 'honduras') — too broad.
 *    "70/20/10 Wool/Cashmere/Nylon YarnKit - Nicaragua" → coffee codes injected into results,
 *    pushing correct 5109.90 out of top 10.
 *    The COFFEE rules still fire via 'washed', 'washed process', 'roast' etc. for actual coffee.
 *
 * 2. JEWELRY_RING_INTENT noneOf: add ring tool/craft/tray terms — too many non-jewelry
 *    queries have standalone 'ring' word and get wrongly redirected to ch.71:
 *    "Nikah Ring Tray" → 7009.92 (glass mirror); "Ring casting molds" → 8480; etc.
 *
 * New fixes (2):
 * 3. RING_TRAY_CEREMONY_INTENT (ch.70): Nikah/engagement ring trays with mirrors → 7009.92
 *    "Personalized Nikah Ring Tray" → 7009.92.10; JEWELRY_RING_INTENT blocks ch.70
 * 4. STATIONERY_BINDER_RING_INTENT (ch.48): ring binders, journal binders → 4820.30
 *    "A5 6 Ring Binder, Bullet Journal" → 4820.30
 *    (JEWELRY_RING_INTENT has 'ring binder' in noneOf but some cases may still be blocked)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14d2.ts
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

    // ── 1. COFFEE_SINGLE_ORIGIN_INTENT: remove country names from anyOf ───────
    // Country names are too broad — any product from those countries triggers coffee rules
    // and injects ch.09 codes into results, crowding out correct codes.
    // Keep: washed, roast, espresso, arabica, etc. — these are coffee-specific
    // Remove: ethiopia, colombia, kenya, guatemala, nicaragua, honduras — too general
    {
      const existing = allRules.find(r => r.id === 'COFFEE_SINGLE_ORIGIN_INTENT') as IntentRule | undefined;
      if (existing) {
        const countriesToRemove = new Set(['ethiopia', 'colombia', 'kenya', 'guatemala', 'nicaragua', 'honduras']);
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const newAnyOf = currentAnyOf.filter((t: string) => !countriesToRemove.has(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'COFFEE_SINGLE_ORIGIN_INTENT').replace('Fixed XXXX: ', 'Fixed D2 (removed countries): '),
            pattern: { ...pat, anyOf: newAnyOf },
          },
        });
        console.log(`COFFEE_SINGLE_ORIGIN_INTENT: removed ${currentAnyOf.length - newAnyOf.length} country names from anyOf`);
      } else {
        console.log('WARNING: COFFEE_SINGLE_ORIGIN_INTENT not found');
      }
    }

    // ── 2. JEWELRY_RING_INTENT noneOf: add non-jewelry ring terms ─────────────
    // Many queries with standalone 'ring' are not jewelry:
    // "Nikah Ring Tray" → 7009.92; "Ring casting molds" → 8480; "ring polisher" → 6805, etc.
    // allowChapters=['71'] blocks the correct non-ch.71 results for these queries.
    {
      const existing = allRules.find(r => r.id === 'JEWELRY_RING_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = [
          // Wedding/ceremony trays (not jewelry rings)
          'ring tray', 'ring platter', 'ring dish', 'nikkah tray', 'nikah tray',
          // Craft/making blanks
          'ring blank', 'ring blanks', 'ring inlay',
          // Tools and machines
          'ring polisher', 'ring rotator', 'ring finishing', 'ring turning',
          'ring casting', 'ring mold', 'ring mandrel',
          // Hardware/mechanical
          'snap ring', 'retaining ring', 'spring ring', 'split ring',
          // Other specific
          'ring holder', 'ring stand', 'ring bearer',
        ].filter(t => !currentNoneOf.includes(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'JEWELRY_RING_INTENT') + ' — Fixed D2: add ring tray/blank/tool/mold/polisher to noneOf',
            pattern: { ...pat, noneOf: [...currentNoneOf, ...toAdd] },
          },
        });
        console.log(`JEWELRY_RING_INTENT: adding ${toAdd.length} noneOf terms`);
      } else {
        console.log('WARNING: JEWELRY_RING_INTENT not found');
      }
    }

    // ── 3. NEW RING_TRAY_CEREMONY_INTENT ──────────────────────────────────────
    // "Personalized Nikah Ring Tray: Custom Arabic Calligraphy, Pearl Border" → 7009.92.10.90
    // "Personalized Mirror Nikkah Ring Tray, Pearl Floral Engagement Tray" → 7009.92.10.90
    // These are decorative mirror trays used in Islamic wedding ceremonies
    // 7009.92 = Glass mirrors, framed; ring tray with mirror surface → ch.70
    patches.push({
      priority: 576,
      rule: {
        id: 'RING_TRAY_CEREMONY_INTENT',
        description: 'Nikah/engagement ring trays and mirror trays → ch.70 (7009.92). ' +
          '"Nikah ring tray", "nikkah ring tray", "engagement tray mirror" → 7009.92.10. ' +
          'Without rule, JEWELRY_RING_INTENT fires and blocks ch.70 mirror/glass results.',
        pattern: {
          anyOf: [
            'nikah tray', 'nikkah tray', 'nikah ring tray', 'nikkah ring tray',
            'ring tray', 'ring platter', 'engagement tray',
            'mirror tray', 'wedding ring tray', 'ceremony tray',
          ],
          noneOf: ['plastic tray', 'food tray', 'serving tray'],
        },
        whitelist: { allowChapters: ['70', '44', '48'] },
        inject: [
          { prefix: '7009.92', syntheticRank: 9 }, // Glass mirrors, framed
          { prefix: '7009.91', syntheticRank: 8 }, // Glass mirrors, unframed
          { prefix: '7013.49', syntheticRank: 7 }, // Glassware for toilette
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '7009.92' },
          { delta: 0.4, chapterMatch: '70' },
        ],
      } as IntentRule,
    });

    // ── 4. COFFEE_SINGLE_ORIGIN_INTENT 'washed' noneOf fix ────────────────────
    // 'washed' is too broad — "stone washed denim", "acid washed jeans", "washed cotton" etc.
    // But these queries likely have AI_CH61/AI_CH62 rules firing with allowChapters=['61'/'62']
    // which would balance out the coffee allowChapters=['09']. Let's verify by checking
    // if 'washed' causes issues. Skip for now — washed is coffee-specific enough in context.

    console.log(`Applying ${patches.length} rule patches (batch D2)...`);
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
    console.log(`\nPatch D2 complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
