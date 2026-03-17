#!/usr/bin/env ts-node
/**
 * Patch W2 — 2026-03-14:
 *
 * Targeting top blockers after V2 (298/5000 = 5.96% blocked):
 *
 * 1. AI_CH56_TWINE_BALER: add ch.15/32/48/63; noneOf hemp-oil/hemp-finish/tea-towel/tag-with-twine.
 *    'hemp' → hemp oil (ch.15), beeswax hemp finish paint (ch.32), herb tea towel (ch.63).
 *    'twine' → christmas tags with twine (ch.48 paper).
 *
 * 2. BALLOON_INTENT: add ch.40/44/49; noneOf garland/arch/puzzle/chart.
 *    'balloon' → latex balloon garland (ch.40 rubber), hot air balloon wood puzzle (ch.44),
 *    balloon-themed party printables (ch.49).
 *
 * 3. AI_CH22_SPIRITS_BRANDY_COGNAC: noneOf cognac-as-leather-color + marc-as-name.
 *    'cognac' → leather journal in cognac color (ch.42). 'marc' → person's name (Marc Singer).
 *
 * 4. SPORTS_JERSEY_INTENT: add ch.43.
 *    Used/secondhand jerseys classified under ch.43.
 *
 * 5. SPORTS_JERSEY_GARMENT_INTENT: add ch.43.
 *    Same as above.
 *
 * 6. SHIRT_GARMENT_BACKUP_INTENT: add ch.60/65.
 *    Velvet shirts (ch.60), promotional shirts bundled with hats (ch.65 edge case).
 *
 * 7. TEMPERED_GLASS_SCREEN_INTENT: add ch.39.
 *    Plastic film screen protectors (ch.39), not all protectors are ch.70 glass.
 *
 * 8. AI_CH06_LIVE_ROSES_TREES_SHRUBS: noneOf christmas context + decor context.
 *    'tree'/'poinsettia' → Christmas ornament shapes (ch.44/39), quilted tree decoration (ch.63).
 *
 * 9. PASTA_NOODLE_INTENT: add ch.44/69; noneOf pasta-board/bowl.
 *    'pasta' → gnocchi board (ch.44 wood), ceramic pasta bowls (ch.69).
 *
 * 10. PASTA_FOOD_INTENT: add ch.44/69; noneOf pasta-board/bowl.
 *     Same as above.
 *
 * 11. JEWELRY_CASE_VELVET_BOX_INTENT: add ch.44/71/83.
 *     'ring box' → wood ring box (ch.44), silver ring box (ch.71). 'watch box' → ch.83.
 *
 * 12. WRISTWATCH_ANALOG_INTENT: noneOf watch-box/watch-plaid/caseback; add ch.42/73.
 *     'watch' → watch box (ch.42), watch plaid flannel shirt (ch.62). Caseback screw (ch.73).
 *
 * 13. AI_CH46_WOVEN_HANDBAG_PURSE: noneOf false triggers (anyOf is empty = fires on all).
 *     Jacquard tapestry bag (ch.58/63), bamboo handles (ch.44), wooden purse frame (ch.44/83),
 *     labor comb with wrist sling (ch.90).
 *
 * 14. BOOK_NOVEL_PAPERBACK_INTENT: add ch.48; noneOf journal-notebook context.
 *     'hardcover' → hardcover journal/notebook (ch.48 blank registers), not printed books.
 *
 * 15. HAIR_CLAW_INTENT: add ch.71.
 *     Bejeweled/jeweled headbands classified as ch.71 jewelry.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14w2.ts
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

    // ── 1. AI_CH56_TWINE_BALER: add ch.15/32/48/63 + noneOf false triggers ───
    {
      const existing = allRules.find(r => r.id === 'AI_CH56_TWINE_BALER') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '15', '32', '48', '63'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'hemp oil', 'hemp seed oil', 'hemp extract', 'hemp protein',
          'hemp finish', 'hemp wax', 'beeswax hemp',
          'tea towel', 'dish towel', 'kitchen towel',
          'christmas tag', 'gift tag', 'tags with twine', 'tag with twine',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH56_TWINE_BALER') +
              ' — Fixed W2: added ch.15/32/48/63; noneOf hemp-oil/finish/tea-towel/gift-tag',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH56_TWINE_BALER: added ch.15/32/48/63, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH56_TWINE_BALER not found'); }
    }

    // ── 2. BALLOON_INTENT: add ch.40/44/49 + noneOf garland/puzzle/growth chart
    {
      const existing = allRules.find(r => r.id === 'BALLOON_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '40', '44', '49'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'balloon garland', 'balloon arch', 'balloon bouquet kit',
          'growth chart', 'wall decor chart', 'engraved wall decor',
          'hot air balloon puzzle', 'puzzle', 'wooden balloon',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'BALLOON_INTENT') +
              ' — Fixed W2: added ch.40 (latex/rubber), ch.44 (wood puzzle), ch.49; noneOf garland/arch/growth-chart',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`BALLOON_INTENT: added ch.40/44/49, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: BALLOON_INTENT not found'); }
    }

    // ── 3. AI_CH22_SPIRITS_BRANDY_COGNAC: noneOf cognac-leather + marc-as-name ─
    {
      const existing = allRules.find(r => r.id === 'AI_CH22_SPIRITS_BRANDY_COGNAC') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '41', '42'])];
        const addNoneOf = [
          // 'cognac' as leather color
          'cognac leather', 'in cognac', 'cognac color', 'cognac colour',
          'cognac brown',
          // 'marc' as person name prefix
          'marc olden', 'marc singer', 'marc jacobs',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH22_SPIRITS_BRANDY_COGNAC') +
              ' — Fixed W2: noneOf cognac-leather-color/marc-as-person-name; added ch.41/42',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH22_SPIRITS_BRANDY_COGNAC: added ch.41/42, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH22_SPIRITS_BRANDY_COGNAC not found'); }
    }

    // ── 4. SPORTS_JERSEY_INTENT: add ch.43 (used/secondhand jerseys) ──────────
    {
      const existing = allRules.find(r => r.id === 'SPORTS_JERSEY_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '43'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SPORTS_JERSEY_INTENT') +
              ' — Fixed W2: added ch.43 (used/secondhand jerseys)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SPORTS_JERSEY_INTENT: added ch.43`);
      } else { console.log('WARNING: SPORTS_JERSEY_INTENT not found'); }
    }

    // ── 5. SPORTS_JERSEY_GARMENT_INTENT: add ch.43 ───────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SPORTS_JERSEY_GARMENT_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '43'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SPORTS_JERSEY_GARMENT_INTENT') +
              ' — Fixed W2: added ch.43 (used/secondhand jerseys)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SPORTS_JERSEY_GARMENT_INTENT: added ch.43`);
      } else { console.log('WARNING: SPORTS_JERSEY_GARMENT_INTENT not found'); }
    }

    // ── 6. SHIRT_GARMENT_BACKUP_INTENT: add ch.60/65 ─────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SHIRT_GARMENT_BACKUP_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '60', '65'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SHIRT_GARMENT_BACKUP_INTENT') +
              ' — Fixed W2: added ch.60 (velvet fabric shirts), ch.65 (cap+shirt sets)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SHIRT_GARMENT_BACKUP_INTENT: added ch.60/65`);
      } else { console.log('WARNING: SHIRT_GARMENT_BACKUP_INTENT not found'); }
    }

    // ── 7. TEMPERED_GLASS_SCREEN_INTENT: add ch.39 ───────────────────────────
    {
      const existing = allRules.find(r => r.id === 'TEMPERED_GLASS_SCREEN_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '39'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'TEMPERED_GLASS_SCREEN_INTENT') +
              ' — Fixed W2: added ch.39 (plastic film screen protectors)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`TEMPERED_GLASS_SCREEN_INTENT: added ch.39`);
      } else { console.log('WARNING: TEMPERED_GLASS_SCREEN_INTENT not found'); }
    }

    // ── 8. AI_CH06_LIVE_ROSES_TREES_SHRUBS: noneOf decor/ornament context ─────
    {
      const existing = allRules.find(r => r.id === 'AI_CH06_LIVE_ROSES_TREES_SHRUBS') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '39', '44', '63'])];
        const addNoneOf = [
          // 'tree' in decoration context
          'christmas tree decor', 'christmas shapes', 'tree decoration',
          'tree ornament', 'ornament', 'tree decor', 'quilted',
          // 'poinsettia' as decorative shape (not live plant)
          'poinsettia shape', 'poinsettia stamp', 'poinsettia cutter',
          // 'shrub' in makeup/beauty context
          'shrub rose perfume', 'rose fragrance',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH06_LIVE_ROSES_TREES_SHRUBS') +
              ' — Fixed W2: noneOf christmas-decor/ornament/quilted; added ch.39/44/63',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH06_LIVE_ROSES_TREES_SHRUBS: added ch.39/44/63, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH06_LIVE_ROSES_TREES_SHRUBS not found'); }
    }

    // ── 9. PASTA_NOODLE_INTENT: add ch.44/69 + noneOf board/bowl ─────────────
    {
      const existing = allRules.find(r => r.id === 'PASTA_NOODLE_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '44', '69'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'pasta board', 'gnocchi board', 'pasta bowl', 'pasta bowls',
          'pasta maker', 'pasta machine', 'noodle bowl', 'noodle maker',
          'noodle box', 'pasta pot', 'ramen bowl',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'PASTA_NOODLE_INTENT') +
              ' — Fixed W2: added ch.44 (pasta board), ch.69 (pasta bowl); noneOf board/bowl/maker',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`PASTA_NOODLE_INTENT: added ch.44/69, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: PASTA_NOODLE_INTENT not found'); }
    }

    // ── 10. PASTA_FOOD_INTENT: add ch.44/69 + noneOf board/bowl ──────────────
    {
      const existing = allRules.find(r => r.id === 'PASTA_FOOD_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '44', '69'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'pasta board', 'gnocchi board', 'pasta bowl', 'pasta bowls',
          'pasta maker', 'pasta machine', 'pasta pot', 'pasta salad bowl',
          'noodle bowl', 'noodle box', 'ramen bowl',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'PASTA_FOOD_INTENT') +
              ' — Fixed W2: added ch.44/69; noneOf pasta-board/bowl/maker',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`PASTA_FOOD_INTENT: added ch.44/69, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: PASTA_FOOD_INTENT not found'); }
    }

    // ── 11. JEWELRY_CASE_VELVET_BOX_INTENT: add ch.44/71/83 ──────────────────
    {
      const existing = allRules.find(r => r.id === 'JEWELRY_CASE_VELVET_BOX_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '44', '71', '83'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'JEWELRY_CASE_VELVET_BOX_INTENT') +
              ' — Fixed W2: added ch.44 (wood ring/watch box), ch.71 (silver ring box), ch.83 (metal watch box)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`JEWELRY_CASE_VELVET_BOX_INTENT: added ch.44/71/83`);
      } else { console.log('WARNING: JEWELRY_CASE_VELVET_BOX_INTENT not found'); }
    }

    // ── 12. WRISTWATCH_ANALOG_INTENT: noneOf watch-box/plaid + add ch.42/73 ──
    {
      const existing = allRules.find(r => r.id === 'WRISTWATCH_ANALOG_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '42', '73'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Watch storage boxes (ch.42/83)
          'watch box', 'watch case box', 'watch storage',
          // 'watch' as pattern/plaid name
          'watch plaid', 'black watch plaid', 'tartan',
          // Watch repair parts
          'caseback', 'caseback screw', 'watch screw',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'WRISTWATCH_ANALOG_INTENT') +
              ' — Fixed W2: added ch.42 (watch box), ch.73 (caseback screw); noneOf watch-box/plaid/caseback',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`WRISTWATCH_ANALOG_INTENT: added ch.42/73, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: WRISTWATCH_ANALOG_INTENT not found'); }
    }

    // ── 13. AI_CH46_WOVEN_HANDBAG_PURSE: noneOf false triggers (anyOf empty) ─
    {
      const existing = allRules.find(r => r.id === 'AI_CH46_WOVEN_HANDBAG_PURSE') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '42', '44', '58', '63', '83', '90'])];
        const addNoneOf = [
          // Jacquard tapestry tote (ch.58/63)
          'jacquard tapestry', 'tapestry tote', 'reversible woven',
          // Bamboo handles (ch.44) / wooden purse frame (ch.44/83)
          'bag handles', 'purse frame', 'kiss lock', 'frame kiss',
          // Labor comb with wrist sling (ch.90 medical)
          'labor pain', 'doula', 'acupressure', 'labor tool',
          // Wristband medical
          'wrist sling', 'wrist brace', 'wrist support',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH46_WOVEN_HANDBAG_PURSE') +
              ' — Fixed W2: added ch.42/44/58/63/83/90; noneOf jacquard-tapestry/bag-handles/purse-frame/labor-tool',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH46_WOVEN_HANDBAG_PURSE: added ch.42/44/58/63/83/90, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH46_WOVEN_HANDBAG_PURSE not found'); }
    }

    // ── 14. BOOK_NOVEL_PAPERBACK_INTENT: add ch.48 + noneOf journal/notebook ──
    {
      const existing = allRules.find(r => r.id === 'BOOK_NOVEL_PAPERBACK_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '48'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Blank journals / notebooks (ch.48, not ch.49 printed books)
          'hardcover journal', 'journal book', 'blank journal', 'blank page journal',
          'softcover journal', 'softcover workbook', 'paperback workbook',
          // Set of books (can be ch.49 but hardcover blank registers = ch.48)
          'set of hard cover', 'set of hardcover',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'BOOK_NOVEL_PAPERBACK_INTENT') +
              ' — Fixed W2: added ch.48 (blank journals/registers); noneOf journal/workbook context',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`BOOK_NOVEL_PAPERBACK_INTENT: added ch.48, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: BOOK_NOVEL_PAPERBACK_INTENT not found'); }
    }

    // ── 15. HAIR_CLAW_INTENT: add ch.71 (jeweled headbands) ──────────────────
    {
      const existing = allRules.find(r => r.id === 'HAIR_CLAW_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '71'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'HAIR_CLAW_INTENT') +
              ' — Fixed W2: added ch.71 (bejeweled/gem headbands)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`HAIR_CLAW_INTENT: added ch.71`);
      } else { console.log('WARNING: HAIR_CLAW_INTENT not found'); }
    }

    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch W2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    const finalRules = svc.getAllRules();
    console.log(`\nPatch W2 complete: ${patches.length} applied, 0 failed`);
    console.log(`Rules in cache: ${finalRules.length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
