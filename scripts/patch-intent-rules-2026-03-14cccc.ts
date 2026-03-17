#!/usr/bin/env ts-node
/**
 * Patch CCCC — 2026-03-14:
 *
 * Fix conflicts in BONE_CHINA_CERAMIC_DISHWARE_INTENT:
 * 'figurine', 'vase', 'ceramic deer' are in BOTH anyOf AND noneOf → noneOf wins → rule doesn't fire
 *
 * Also:
 * - Add inject + boosts to AI_CH69_CERAMIC_FIGURINE (currently has neither)
 * - addNoneOf to AI_CH54_ELASTOMERIC_YARN: garment terms (fixes spandex/elastane clothing queries)
 * - NEW HOSIERY_STOCKING_PANTYHOSE_INTENT: pantyhose, stockings, tights → 6115 ch.61
 * - NEW NECKTIE_SCARF_ACCESSORY_INTENT: necktie, pocket square, bow tie → 6215/6214 ch.62
 * - addNoneOf AI_CH01_LIVE_CAMELIDS: garment terms to prevent 'alpaca' routing to live animals
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14cccc.ts
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
      patches.push({ priority: (existing as any).priority ?? 500, rule: { ...existing, description: (existing.description ?? ruleId) + ` — Fixed CCCC: ${note}`, pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] } } });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. Fix BONE_CHINA_CERAMIC_DISHWARE_INTENT noneOf conflict ─────────────
    // 'figurine', 'vase', etc. are now in BOTH anyOf AND noneOf → noneOf wins → rule skips
    // Fix: remove conflicting terms from noneOf
    {
      const existing = allRules.find(r => r.id === 'BONE_CHINA_CERAMIC_DISHWARE_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const anyOf: string[] = pat.anyOf ?? [];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        // Remove from noneOf any terms that are also in anyOf
        const anyOfSet = new Set(anyOf);
        const cleanedNoneOf = currentNoneOf.filter(t => !anyOfSet.has(t));
        console.log(`BONE_CHINA_CERAMIC_DISHWARE_INTENT: removing ${currentNoneOf.length - cleanedNoneOf.length} conflicting noneOf terms`);
        patches.push({
          priority: (existing as any).priority ?? 562,
          rule: {
            ...existing,
            description: (existing.description ?? 'BONE_CHINA_CERAMIC_DISHWARE_INTENT') +
              ' — Fixed CCCC: removed anyOf/noneOf conflicts (figurine, vase were in both)',
            pattern: { ...pat, noneOf: cleanedNoneOf },
          },
        });
      } else {
        console.log('WARNING: BONE_CHINA_CERAMIC_DISHWARE_INTENT not found');
      }
    }

    // ── 2. Add inject + boosts to AI_CH69_CERAMIC_FIGURINE ────────────────────
    // Currently has 'figurine' in anyOf but NO inject/boosts → no ch.69 entries surfaced
    {
      const existing = allRules.find(r => r.id === 'AI_CH69_CERAMIC_FIGURINE') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH69_CERAMIC_FIGURINE') +
              ' — Fixed CCCC: added inject+boosts for 6913 statuette/ornamental entries.',
            inject: [
              { prefix: '6913.10.10', syntheticRank: 9 }, // Porcelain/china ornamental articles
              { prefix: '6913.10.20', syntheticRank: 8 }, // Other porcelain ornamental articles
              { prefix: '6913.90.10', syntheticRank: 7 }, // Other ornamental articles
              { prefix: '6913.90.50', syntheticRank: 6 }, // Other ornamental articles (nec)
            ],
            boosts: [
              { delta: 0.5, prefixMatch: '6913' }, // Statuettes and ornamental articles
              { delta: 0.3, prefixMatch: '6912' }, // Household articles
            ],
          } as IntentRule,
        });
        console.log('AI_CH69_CERAMIC_FIGURINE: adding inject + boosts for 6913');
      } else {
        console.log('WARNING: AI_CH69_CERAMIC_FIGURINE not found');
      }
    }

    // ── 3. AI_CH54_ELASTOMERIC_YARN: add garment noneOf ─────────────────────
    // anyOf=['spandex','lycra','elastane',...] with allowChapters=['54']
    // "ladies 95% Bamboo Rayon 5% Spandex Dolman Monkey Top" → 'spandex' fires → blocks ch.61
    addNoneOf('AI_CH54_ELASTOMERIC_YARN', [
      'shirt', 'shirts', 'tshirt', 'tshirts', 't-shirt',
      'dress', 'dresses', 'skirt', 'pants', 'trousers', 'jeans',
      'jacket', 'coat', 'blazer', 'cardigan', 'sweater', 'vest',
      'blouse', 'tunic', 'top', 'hoodie', 'sweatshirt', 'leggings',
      'socks', 'stockings', 'tights', 'bodysuit', 'leotard',
      'swimsuit', 'swimwear', 'bikini', 'sports bra', 'bra',
      'underwear', 'briefs', 'boxer',
      'clothing', 'apparel', 'garment', 'wear', 'outfit',
    ], 'added garment terms → elastomeric yarn rule must not fire for clothing queries');

    // ── 4. AI_CH01_LIVE_CAMELIDS: add garment noneOf ─────────────────────────
    // anyOf=['alpaca','llama','camel',...] with null whitelist but causes semantic confusion
    // Adding garment noneOf prevents 'alpaca' from matching clothing queries in weird ways
    addNoneOf('AI_CH01_LIVE_CAMELIDS', [
      'shirt', 'sweater', 'cardigan', 'vest', 'jacket', 'coat',
      'scarf', 'shawl', 'wrap', 'poncho',
      'socks', 'gloves', 'hat', 'beanie',
      'yarn', 'wool', 'fiber', 'fibre',
      'clothing', 'apparel', 'garment', 'wear',
    ], 'added garment/fiber terms → live camelid rule must not fire for alpaca clothing queries');

    // ── 5. NEW HOSIERY_STOCKING_PANTYHOSE_INTENT ─────────────────────────────
    // "Nude pantyhose", "vintage pantyhose", "Vintage Stockings" → 6115 (ch.61)
    patches.push({
      priority: 574,
      rule: {
        id: 'HOSIERY_STOCKING_PANTYHOSE_INTENT',
        description: 'Hosiery, pantyhose, stockings, tights → 6115 (ch.61). ' +
          '"Pantyhose", "stockings", "tights", "fishnets" → 6115.10/6115.20. ' +
          'Without rule, hosiery queries return EMPTY.',
        pattern: {
          anyOf: [
            'pantyhose', 'panty hose', 'panty-hose',
            'stockings', 'nylon stockings', 'silk stockings', 'seamed stockings',
            'tights', 'women tights', 'dance tights', 'footed tights',
            'leggings', 'footless tights', 'compression tights',
            'fishnet', 'fishnets', 'fishnet stockings', 'fishnet tights',
            'hold ups', 'hold-ups', 'thigh highs', 'thigh-highs',
            'knee highs', 'knee-highs', 'over the knee socks',
          ],
          noneOf: [
            'pants', 'trousers', 'jeans',  // Not pants/trousers
            'sock', 'socks', 'ankle socks',  // Short socks handled separately
          ],
        },
        whitelist: { allowChapters: ['61', '62'] },
        inject: [
          { prefix: '6115.10.60', syntheticRank: 9 }, // Graduated compression hosiery
          { prefix: '6115.21.00', syntheticRank: 8 }, // Seamless tights/pantyhose
          { prefix: '6115.22.00', syntheticRank: 7 }, // Full-length/knee-length hosiery (synthetic)
          { prefix: '6115.29.40', syntheticRank: 6 }, // Other full-length hosiery
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '6115' },
        ],
      } as IntentRule,
    });

    // ── 6. NEW NECKTIE_SCARF_FASHION_ACCESSORY_INTENT ────────────────────────
    // "Rose Gold Italian Satin Neck Tie" → 6215 (ch.62)
    // "Copper Raw Silk Pocket Square" → 6214 (ch.62) 
    // "bow tie", "cravat", "ascot" → 6215 (ch.62)
    patches.push({
      priority: 571,
      rule: {
        id: 'NECKTIE_SCARF_FASHION_ACCESSORY_INTENT',
        description: 'Neckties, bow ties, pocket squares → 6215/6214 (ch.62). ' +
          '"Neck tie", "bow tie", "pocket square", "cravat" → 6215.20/6215.90. ' +
          '"Silk pocket square", "satin tie" → ch.62 accessories. ' +
          'Without rule, necktie queries return EMPTY.',
        pattern: {
          anyOf: [
            // Neckties
            'neck tie', 'necktie', 'neckties', 'neck ties',
            'tie', 'ties', 'satin tie', 'silk tie', 'woven tie', 'knit tie',
            'bow tie', 'bow ties', 'bowtie', 'bowties',
            'cravat', 'cravats', 'ascot', 'ascots',
            // Pocket squares
            'pocket square', 'pocket squares', 'handkerchief', 'hanky',
          ],
          noneOf: [
            'zip tie', 'cable tie', 'wire tie',  // Hardware ties
            'hair tie', 'hair band', 'scrunchie',  // Hair accessories
            'belt', 'shoe lace', 'shoelace',
            'bookmark', 'bag', 'purse',  // Not accessories
          ],
        },
        whitelist: { allowChapters: ['62', '61', '63'] },
        inject: [
          { prefix: '6215.20.00', syntheticRank: 9 }, // Silk neckties
          { prefix: '6215.90.00', syntheticRank: 8 }, // Other neckties/bow ties
          { prefix: '6214.20.00', syntheticRank: 7 }, // Shawls/scarves of wool/fine hair
          { prefix: '6217.10.10', syntheticRank: 6 }, // Other accessories (handkerchiefs)
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '6215' },
          { delta: 0.3, prefixMatch: '6217' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch CCCC)...`);
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
    console.log(`\nPatch CCCC complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
