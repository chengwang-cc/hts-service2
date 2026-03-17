#!/usr/bin/env ts-node
/**
 * Patch SSSS — 2026-03-14:
 *
 * Bug fixes and refinements:
 * 1. AI_CH45_CORK_RAW: re-add gemstone/inlaying terms (OOOO's double-upsert overwrote them)
 *    "Crushed stone for inlaying" → still blocked because OOOO patch 2nd upsert overwrote gemstone noneOf
 *
 * 2. HANDMADE_WASHI_PAPER_INTENT: add banner/bridal/party noneOf to prevent regression
 *    "handmade paper bridal party banner" → RRRR rule now wrongly returns 4802.10 instead of 4802.56
 *
 * 3. Update PET_ACCESSORY_INTENT: add pet necklace to anyOf + fix inject syntheticRank
 *    "1 Ring Leather Pet Necklace" → inject 4201 with rank=0 doesn't boost enough; needs rank=9
 *
 * 4. Update GEMSTONE_CABOCHON_INTENT: add crushed stone/inlaying to anyOf + inject 7105.90
 *    "Crushed stone for inlaying" → 7105.90 (dust/powder of precious stones); inject missing
 *
 * 5. NEW QUARTZ_CRYSTAL_CARVED_INTENT (ch.71): carved quartz crystal/crystal orb → 7104.10
 *    "Carved Natural Quartz Crystal" → 7104.10 (piezo-electric quartz); gets wrong 7103 code
 *
 * 6. Update AI_CH02_OFFAL noneOf: already added in RRRR, verify working
 *
 * 7. Update SEMI_PRECIOUS_STONE_MARBLE_INTENT to fix 9302 (pistols) routing
 *    "semi precious marbles" → still getting 9302 (firearms!) despite new rule
 *    Root cause: semantic embedding routes "marbles" close to "firearms" - need noneOf in firearms rules
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14ssss.ts
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

    function addNoneOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentNoneOf: string[] = pat.noneOf ?? [];
      const newTerms = toAdd.filter(t => !currentNoneOf.includes(t));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed SSSS: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    function addToAnyOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentAnyOf: string[] = pat.anyOf ?? [];
      const newTerms = toAdd.filter(t => !currentAnyOf.includes(t));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed SSSS: ${note}`,
          pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} anyOf terms`);
    }

    // ── 1. AI_CH45_CORK_RAW: re-add gemstone terms lost in OOOO double-upsert bug ─
    // OOOO applied two addNoneOf calls for AI_CH45_CORK_RAW in same batch.
    // Second call used same allRules snapshot → overwrote first upsert.
    // Gemstone terms (opal/inlaying/crushed opal) are now MISSING from noneOf.
    addNoneOf('AI_CH45_CORK_RAW', [
      'opal', 'gemstone', 'inlaying', 'inlay', 'crushed opal', 'crushed stone',
      'shell', 'mother of pearl', 'abalone', 'turquoise',
    ], 'restore gemstone/inlaying context lost due to OOOO double-upsert overwrite');

    // ── 2. HANDMADE_WASHI_PAPER_INTENT: prevent banner/bridal regression ──────────
    // "handmade paper bridal party banner" → 4802.56 expected, but RRRR wrongly returns 4802.10
    // 'handmade paper' phrase matches → injects 4802.10 for banner queries
    addNoneOf('HANDMADE_WASHI_PAPER_INTENT', [
      'banner', 'party banner', 'bridal party banner', 'bunting', 'bridal',
      'party decoration', 'garland', 'paper banner', 'wall hanging',
    ], 'banner/bridal context prevents washi paper rule from boosting 4802.10 for party banners');

    // ── 3. PET_ACCESSORY_INTENT: add pet necklace + fix inject rank ───────────────
    // "1 Ring Leather Pet Necklace" → 4201 needed but inject syntheticRank=0 not enough
    // Also add pet necklace/dog necklace to anyOf so rule fires for necklace queries
    {
      const existing = allRules.find(r => r.id === 'PET_ACCESSORY_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const newAnyOf = [...currentAnyOf, ...['pet necklace', 'dog necklace', 'cat necklace', 'pet harness', 'animal collar'].filter(t => !currentAnyOf.includes(t))];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'PET_ACCESSORY_INTENT') + ' — Fixed SSSS: add pet necklace + fix inject rank',
            pattern: { ...pat, anyOf: newAnyOf },
            inject: [
              { prefix: '4201.00', syntheticRank: 9 }, // Saddlery and harness for animals
            ],
            boosts: [
              { delta: 0.5, prefixMatch: '4201' },
              { delta: 0.4, chapterMatch: '42' },
            ],
          } as IntentRule,
        });
        console.log('PET_ACCESSORY_INTENT: updating anyOf + inject rank');
      } else {
        console.log('WARNING: PET_ACCESSORY_INTENT not found');
      }
    }

    // ── 4. GEMSTONE_CABOCHON_INTENT: add crushed stone + inject 7105.90 ──────────
    // "Crushed stone for inlaying and crafting" → 7105.90 (dust/powder of precious stones)
    // Currently has inject 7103.91/7103.99/7116.10 but missing 7105.90
    {
      const existing = allRules.find(r => r.id === 'GEMSTONE_CABOCHON_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const currentInject: any[] = (existing as any).inject ?? [];
        const currentPrefixes = new Set(currentInject.map((i: any) => i.prefix));
        const newAnyOf = [...currentAnyOf,
          ...['crushed stone', 'stone dust', 'stone powder', 'gem dust', 'gem powder',
            'inlaying', 'for inlaying', 'tourmaline', 'sapphire', 'ruby', 'emerald',
            'garnet', 'amethyst', 'topaz', 'jade', 'citrine',
          ].filter(t => !currentAnyOf.includes(t))];
        const newInject = [
          { prefix: '7105.90', syntheticRank: 9 }, // Dust/powder of precious/semi-precious stones
          { prefix: '7103.91', syntheticRank: 8 }, // Other precious stones, unworked
          { prefix: '7103.99', syntheticRank: 7 }, // Other stones, worked
        ];
        const filteredInject = newInject.filter(i => !currentPrefixes.has(i.prefix));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'GEMSTONE_CABOCHON_INTENT') + ' — Fixed SSSS: add crushed stone + 7105.90 inject',
            pattern: { ...pat, anyOf: newAnyOf },
            inject: [...filteredInject, ...currentInject],
          } as IntentRule,
        });
        console.log(`GEMSTONE_CABOCHON_INTENT: adding ${newAnyOf.length - currentAnyOf.length} anyOf + inject 7105.90`);
      } else {
        console.log('WARNING: GEMSTONE_CABOCHON_INTENT not found');
      }
    }

    // ── 5. NEW QUARTZ_CRYSTAL_CARVED_INTENT ───────────────────────────────────────
    // "Carved Natural Quartz Crystal: Flower Shape Crystal" → 7104.10 (piezo-electric quartz)
    // "heart shaped quartz" → 7104.99 (other stones)
    // System wrongly returns 7103 (precious stones) or gets blocked by AI_CH02_OFFAL (heart)
    patches.push({
      priority: 561,
      rule: {
        id: 'QUARTZ_CRYSTAL_CARVED_INTENT',
        description: 'Quartz crystals, crystal carvings, crystal spheres → ch.71 (7104.10). ' +
          '"Carved quartz crystal", "crystal orb", "crystal sphere", "quartz point" → 7104.10. ' +
          'Without rule, gets 7103 (natural precious stones) instead of 7104 (piezo-electric quartz).',
        pattern: {
          anyOf: [
            'quartz crystal', 'carved crystal', 'crystal orb', 'crystal sphere', 'crystal ball',
            'quartz point', 'crystal point', 'crystal tower', 'natural crystal',
            'crystal carving', 'crystal cluster', 'crystal heart', 'amethyst cluster',
            'selenite', 'selenite crystal', 'clear quartz', 'rose quartz', 'smoky quartz',
          ],
          noneOf: ['glass crystal', 'crystal glass', 'chandelier crystal', 'swarovski', 'rhinestone'],
        },
        whitelist: { allowChapters: ['71'] },
        inject: [
          { prefix: '7104.10', syntheticRank: 9 }, // Piezo-electric quartz
          { prefix: '7104.99', syntheticRank: 8 }, // Other cut/worked stones
          { prefix: '7103.10', syntheticRank: 7 }, // Precious/semi-precious stones, unworked
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '7104' },
          { delta: 0.4, chapterMatch: '71' },
        ],
      } as IntentRule,
    });

    // ── 6. Fix FIREARMS rules to not route gemstone "marbles" to ch.93 ─────────────
    // "semi precious marbles" → 9302.00 (pistols!) due to semantic routing
    // Need to check AI_CH93_FIREARM or similar rule
    // Add 'semi precious', 'gemstone', 'stone marble' to noneOf of any firearms rules
    addNoneOf('AI_CH93_AIRGUN', [
      'semi precious', 'gemstone', 'stone marble', 'agate', 'onyx', 'mineral marble',
      'marble bead', 'gem bead',
    ], 'gemstone marble context prevents firearm rule from blocking ch.71 semi-precious stone marbles');

    console.log(`Applying ${patches.length} rule patches (batch SSSS)...`);
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
    console.log(`\nPatch SSSS complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
