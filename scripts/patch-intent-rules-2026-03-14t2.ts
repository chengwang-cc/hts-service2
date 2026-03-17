#!/usr/bin/env ts-node
/**
 * Patch T2 — 2026-03-14:
 *
 * Targeting top blockers after S2 (400/5000 = 8.00% blocked):
 *
 * 1. AI_CH31_ORGANIC_ANIMAL_FERTILIZER: noneOf for 'bone' as shape/fossil.
 *    'bone' → resin dog tags in bone shape (ch.39), dinosaur fossil bone (ch.25).
 *
 * 2. AI_CH15_VEGETABLE_WAX_BEESWAX + AI_CH15_BEESWAX: noneOf for beeswax finish/coating.
 *    'beeswax' → Fusion Mineral Paint beeswax finish (ch.32), beeswax distressing block (ch.34).
 *
 * 3. SPICE_INTENT: noneOf for spice storage/tools + add ch.33/44/80.
 *    'spice' → wooden spice cabinet/pepper mill (ch.44), tin spice box (ch.80).
 *    'cinnamon' → apple cinnamon wax melt (ch.33).
 *
 * 4. BONE_CHINA_CERAMIC_DISHWARE_INTENT: add ch.34/68 + noneOf metal tea cup.
 *    'figurine' → clay cat figurine (ch.34), plaster goddess figurine (ch.68).
 *    'tea cup' → metal and wood tea cup (ch.82).
 *
 * 5. AI_CH69_CERAMIC_MISC_HOUSEHOLD: add ch.34/68/74/79 to allowChapters.
 *    Capybara trinket dish (ch.34), gypsum candle holder (ch.68), copper pepper shakers (ch.74),
 *    zinc candlestick (ch.79).
 *
 * 6. NAIL_RIVET_INTENT: noneOf for nail polish + add ch.83 for craft rivets.
 *    'nail' → nail polish (ch.39). 'rivets' → leather goods craft rivets (ch.83).
 *
 * 7. AI_CH40_RUBBER_HOSE_PIPE: add ch.39/84/85 + noneOf silicone tubing.
 *    'tubing' → silicone tubing (ch.39 = plastic). 'hose' → engine intake hose (ch.84), radiator hose (ch.85).
 *
 * 8. AI_CH14_PLAITING_MATERIALS: noneOf bamboo handle/drinking straw/picnic trunk + add ch.39/44.
 *    'bamboo' → bamboo bag handles (ch.44). 'straw' → metal tea cup with drink straw (ch.82).
 *    'rattan' → rattan-look plastic picnic trunk (ch.39).
 *
 * 9. AI_CH58_RIBBON_TRIM: noneOf hair ribbon/hard drive ribbon/entry ribbon + add ch.39/62.
 *    'ribbon' → plastic wedding entry ribbon (ch.39), silk hair ribbon (ch.62),
 *    hard drive ribbon cable (ch.85).
 *
 * 10. BOARD_GAME_INTENT: add ch.39/44 to allowChapters.
 *     Board game accessories: acrylic overlay (ch.39), wooden tokens/stands (ch.44).
 *
 * 11. PET_ACCESSORY_INTENT: add ch.39/40 + noneOf resin dog tag.
 *     Pet ID tags in plastic (ch.39), silicone/rubber pet attachments (ch.40).
 *     'dog tag' → resin dog tags in bone shape (plastic novelty, not pet collar).
 *
 * 12. AI_CH40_RUBBER_GASKET_SEAL: noneOf safety seal/grommet tape/washer machine parts.
 *     'seal' → plastic safety seal (ch.39). 'grommet' → textile grommet tape (ch.55).
 *     'washer' → appliance pressure switch washer, thrust washer plate (ch.84).
 *
 * 13. SWIMWEAR_INTENT: add ch.40/60 for swimwear materials.
 *     Swimwear elastic (ch.40 rubber), swimwear lining/fabric (ch.60 knit).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14t2.ts
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

    // ── 1. AI_CH31_ORGANIC_ANIMAL_FERTILIZER: noneOf bone as shape/fossil ────
    {
      const existing = allRules.find(r => r.id === 'AI_CH31_ORGANIC_ANIMAL_FERTILIZER') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'bone' as shape/material (resin dog tags in bone shape → ch.39)
          'bone shape', 'bone shaped', 'resin dog tag', 'dog tag', 'tag in',
          // 'bone' as fossil/mineral (dinosaur bone → ch.25)
          'dinosaur bone', 'dinosaur', 'fossil bone', 'allosaurus',
          // 'bone china' is ceramic, already handled by other rules
          'bone china',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH31_ORGANIC_ANIMAL_FERTILIZER') +
              ' — Fixed T2: noneOf bone shape/resin dog tag/dinosaur fossil (non-fertilizer bone uses)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH31_ORGANIC_ANIMAL_FERTILIZER: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH31_ORGANIC_ANIMAL_FERTILIZER not found'); }
    }

    // ── 2a. AI_CH15_VEGETABLE_WAX_BEESWAX: noneOf beeswax finish/coating ─────
    {
      const existing = allRules.find(r => r.id === 'AI_CH15_VEGETABLE_WAX_BEESWAX') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'beeswax' as coating/finish product (ch.32/34)
          'beeswax finish', 'fusion mineral', 'mineral paint', 'hemp finish',
          'distressing block', 'food safe finish', 'natural finish',
          'beeswax wood finish', 'beeswax hemp',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH15_VEGETABLE_WAX_BEESWAX') +
              ' — Fixed T2: noneOf beeswax finish/mineral paint/distressing block (beeswax as coating ≠ raw wax)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH15_VEGETABLE_WAX_BEESWAX: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH15_VEGETABLE_WAX_BEESWAX not found'); }
    }

    // ── 2b. AI_CH15_BEESWAX: noneOf beeswax finish/coating ──────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH15_BEESWAX') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'beeswax' as coating/finish product (ch.32/34)
          'beeswax finish', 'fusion mineral', 'mineral paint', 'hemp finish',
          'distressing block', 'food safe finish', 'natural finish',
          'beeswax wood finish', 'beeswax hemp',
          // Already has candle/polish/cosmetic/lip, add more
          'candles', 'wax melt', 'wax melts', 'diamond painting',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH15_BEESWAX') +
              ' — Fixed T2: noneOf beeswax finish/mineral paint/distressing block (beeswax as coating ≠ raw wax)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH15_BEESWAX: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH15_BEESWAX not found'); }
    }

    // ── 3. SPICE_INTENT: noneOf spice containers/tools + add ch.33/44/80 ─────
    {
      const existing = allRules.find(r => r.id === 'SPICE_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.33 (cinnamon-scented wax melt air freshener), ch.44 (wooden spice cabinet/pepper mill),
        // ch.80 (vintage tin spice box)
        const newChapters = [...new Set([...currentChapters, '33', '44', '80'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Spice storage / containers (not the spice itself)
          'spice cabinet', 'spice rack', 'spice box', 'spice jars', 'spice jar',
          'spice tin', 'spice set', 'spice organizer',
          // Spice grinding tools
          'spice grinder', 'pepper mill', 'spice mill',
          // 'cinnamon' as fragrance (wax melt)
          'wax melt', 'cinnamon melt', 'air freshener scent',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SPICE_INTENT') +
              ' — Fixed T2: added ch.33/44/80; noneOf spice cabinet/rack/grinder/pepper mill',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SPICE_INTENT: added ch.33/44/80, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: SPICE_INTENT not found'); }
    }

    // ── 4. BONE_CHINA_CERAMIC_DISHWARE_INTENT: add ch.34/68 + noneOf ─────────
    {
      const existing = allRules.find(r => r.id === 'BONE_CHINA_CERAMIC_DISHWARE_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.34 (clay/modeling-paste figurines classified as 3407), ch.68 (plaster/gypsum figurines)
        const newChapters = [...new Set([...currentChapters, '34', '68'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Metal tea cup/serving items (not ceramic dishware)
          'metal and wood tea cup', 'metal tea cup', 'metal cup with straw',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'BONE_CHINA_CERAMIC_DISHWARE_INTENT') +
              ' — Fixed T2: added ch.34 (clay figurine), ch.68 (gypsum figurine); noneOf metal tea cup',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`BONE_CHINA_CERAMIC_DISHWARE_INTENT: added ch.34/68, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: BONE_CHINA_CERAMIC_DISHWARE_INTENT not found'); }
    }

    // ── 5. AI_CH69_CERAMIC_MISC_HOUSEHOLD: add ch.34/68/74/79 ────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH69_CERAMIC_MISC_HOUSEHOLD') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.34 (clay trinket dish), ch.68 (plaster/stone candle holder),
        // ch.74 (copper salt/pepper shakers), ch.79 (zinc/pewter candlestick)
        const newChapters = [...new Set([...currentChapters, '34', '68', '74', '79'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH69_CERAMIC_MISC_HOUSEHOLD') +
              ' — Fixed T2: added ch.34 (clay dish), ch.68 (gypsum holder), ch.74 (copper shakers), ch.79 (zinc candlestick)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH69_CERAMIC_MISC_HOUSEHOLD: added ch.34/68/74/79`);
      } else { console.log('WARNING: AI_CH69_CERAMIC_MISC_HOUSEHOLD not found'); }
    }

    // ── 6. NAIL_RIVET_INTENT: noneOf nail polish + add ch.83 ─────────────────
    {
      const existing = allRules.find(r => r.id === 'NAIL_RIVET_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.83 (8308 = clasps, frames, eyelets, rivets for leather/garment goods)
        const newChapters = [...new Set([...currentChapters, '83'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Nail polish / nail care (ch.39 - cosmetics)
          'nail polish', 'nail varnish', 'nail lacquer', 'nail gel', 'gel polish',
          'nail care', 'nail treatment',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'NAIL_RIVET_INTENT') +
              ' — Fixed T2: added ch.83 (leather craft rivets); noneOf nail polish/varnish',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`NAIL_RIVET_INTENT: added ch.83, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: NAIL_RIVET_INTENT not found'); }
    }

    // ── 7. AI_CH40_RUBBER_HOSE_PIPE: add ch.39/84/85 + noneOf silicone ───────
    {
      const existing = allRules.find(r => r.id === 'AI_CH40_RUBBER_HOSE_PIPE') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.39 (silicone/plastic tubing), ch.84 (engine intake hoses), ch.85 (motorcycle radiator hoses)
        const newChapters = [...new Set([...currentChapters, '39', '84', '85'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Silicone tubing (ch.39 - plastic, not rubber)
          'silicone tubing', 'silicone tube', 'silicone hose',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH40_RUBBER_HOSE_PIPE') +
              ' — Fixed T2: added ch.39/84/85 (silicone/engine/radiator hose); noneOf silicone tubing',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH40_RUBBER_HOSE_PIPE: added ch.39/84/85, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH40_RUBBER_HOSE_PIPE not found'); }
    }

    // ── 8. AI_CH14_PLAITING_MATERIALS: noneOf handles/straw + add ch.39/44 ───
    {
      const existing = allRules.find(r => r.id === 'AI_CH14_PLAITING_MATERIALS') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.39 (rattan-look plastic items), ch.44 (bamboo articles/handles)
        const newChapters = [...new Set([...currentChapters, '39', '44'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Bamboo bag handles (not plaiting material)
          'bamboo handle', 'bamboo handles', 'bamboo bag handle', 'bag handle',
          'purse handle', 'diy purse',
          // Drinking straw in product name (not plaiting straw)
          'with straw', 'drinking straw', 'metal straw',
          // Rattan-look plastic trunk (not raw plaiting material)
          'picnic trunk', 'rattan trunk', 'rattan picnic',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH14_PLAITING_MATERIALS') +
              ' — Fixed T2: added ch.39/44; noneOf bamboo handle/drinking straw/picnic trunk',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH14_PLAITING_MATERIALS: added ch.39/44, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH14_PLAITING_MATERIALS not found'); }
    }

    // ── 9. AI_CH58_RIBBON_TRIM: noneOf hair/hard drive/entry ribbon + ch.39/62
    {
      const existing = allRules.find(r => r.id === 'AI_CH58_RIBBON_TRIM') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.39 (plastic ribbon banner), ch.62 (silk hair ribbon garment accessory)
        const newChapters = [...new Set([...currentChapters, '39', '62'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Electronic ribbon cable / flex cable
          'hard drive ribbon', 'ribbon cable', 'flex ribbon', 'flat ribbon cable',
          'ide ribbon', 'audio ribbon', 'ribbon for audio',
          // Hair ribbon as garment accessory (not textile trim ribbon)
          'silk hair ribbon', 'hair ribbon', 'hair bow ribbon',
          // Wedding entry ribbon banner (plastic decorative)
          'wedding entry', 'entry ribbon',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH58_RIBBON_TRIM') +
              ' — Fixed T2: added ch.39/62; noneOf hair ribbon/hard drive ribbon/entry ribbon',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH58_RIBBON_TRIM: added ch.39/62, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH58_RIBBON_TRIM not found'); }
    }

    // ── 10. BOARD_GAME_INTENT: add ch.39/44 ──────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'BOARD_GAME_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.39 (acrylic board game overlay), ch.44 (wooden tokens, stands, markers)
        const newChapters = [...new Set([...currentChapters, '39', '44'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'BOARD_GAME_INTENT') +
              ' — Fixed T2: added ch.39 (acrylic overlay), ch.44 (wooden game tokens/stands)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`BOARD_GAME_INTENT: added ch.39/44`);
      } else { console.log('WARNING: BOARD_GAME_INTENT not found'); }
    }

    // ── 11. PET_ACCESSORY_INTENT: add ch.39/40 + noneOf resin dog tag ────────
    {
      const existing = allRules.find(r => r.id === 'PET_ACCESSORY_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.39 (plastic pet ID tags), ch.40 (rubber/silicone pet collar attachments)
        const newChapters = [...new Set([...currentChapters, '39', '40'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Resin dog tags in bone shape (novelty/decorative, not actual pet ID tags)
          'resin dog tag', 'bone shape', 'bone shaped', 'cream bone', 'magenta bone',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'PET_ACCESSORY_INTENT') +
              ' — Fixed T2: added ch.39/40 (plastic/rubber pet accessories); noneOf resin dog tag bone shape',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`PET_ACCESSORY_INTENT: added ch.39/40, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: PET_ACCESSORY_INTENT not found'); }
    }

    // ── 12. AI_CH40_RUBBER_GASKET_SEAL: noneOf safety seal/grommet/washer ────
    {
      const existing = allRules.find(r => r.id === 'AI_CH40_RUBBER_GASKET_SEAL') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Safety seal (plastic tamper-evident seal → ch.39)
          'safety seal', 'tamper seal', 'tamper-evident',
          // Grommet tape for clothing (textile grommet trim → ch.55)
          'grommet tape', 'punk goth', 'alternative clothing',
          // Machine washer/seal (not rubber gasket, but appliance/automotive part)
          'pressure switch', 'water level', 'thrust washer', 'washer plate',
          'automatic thrust', 'automatic washer',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH40_RUBBER_GASKET_SEAL') +
              ' — Fixed T2: noneOf safety seal/grommet tape/thrust washer/pressure switch',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH40_RUBBER_GASKET_SEAL: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH40_RUBBER_GASKET_SEAL not found'); }
    }

    // ── 13. SWIMWEAR_INTENT: add ch.40/60 ────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SWIMWEAR_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.40 (swimwear elastic - rubber elastic tape), ch.60 (swimwear lining/knit fabric)
        const newChapters = [...new Set([...currentChapters, '40', '60'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SWIMWEAR_INTENT') +
              ' — Fixed T2: added ch.40 (swimwear elastic/rubber), ch.60 (swimwear lining/knit fabric)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SWIMWEAR_INTENT: added ch.40/60`);
      } else { console.log('WARNING: SWIMWEAR_INTENT not found'); }
    }

    // ── Apply all patches ─────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch T2)...`);
    let applied = 0;
    let failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await (svc as any).upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
        applied++;
      } catch (err: any) {
        console.error(`  ❌ ${rule.id}: ${err.message}`);
        failed++;
      }
    }

    console.log(`\nPatch T2 complete: ${applied} applied, ${failed} failed`);
    console.log(`Rules in cache: ${(svc.getAllRules() as any[]).length}`);

  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
