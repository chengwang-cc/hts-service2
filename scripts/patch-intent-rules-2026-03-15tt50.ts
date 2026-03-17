#!/usr/bin/env ts-node
/**
 * Patch TT50 — 2026-03-15: Add whitelist filters to TT48 rules that aren't overriding organic results.
 * Current: ~34.13% (TT48+TT49 pending cache)
 *
 * Problem: TT48 inject+boost rules aren't winning over dominant organic results:
 *  - WOMEN_LEGGING_KNIT_INTENT: inject 6104.62 not overriding 6115 (hosiery ch.61) + 6406 (footwear)
 *    "womens leggings" → 6115.29 (hosiery) instead of 6104.62 (knit trousers)
 *    Fix: add whitelist denyPrefixes: ['6115', '6406'] to block hosiery/footwear when legging fires
 *  - ANIME_NOVELTY_KEYCHAIN_PLASTIC_INTENT: inject 3926.90 not overriding 7326.20 (metal keychain)
 *    "Fire Emblem Keychains" → 7326.20 (metal) instead of 3926.90 (plastic)
 *    Fix: add whitelist denyChapters: ['73'] to block metal chapter when anime keychain fires
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt50.ts
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

    // UPDATE WOMEN_LEGGING_KNIT_INTENT — add whitelist to block hosiery + footwear
    // Problem: "womens leggings" → 6115.29 (panty hose/hosiery, ch.61) and 6406.90 (footwear ch.64)
    // Both 6115 and 6104 are in ch.61, but 6115 = hosiery, 6104 = knit suits/jackets/trousers
    // Fix: denyPrefixes 6115 (hosiery) + denyChapters 64 (footwear)
    {
      const existing = allRules.find(r => r.id === 'WOMEN_LEGGING_KNIT_INTENT');
      if (existing) {
        const hasWhitelist = !!(existing as any).whitelist;
        if (!hasWhitelist) {
          const updated = {
            ...existing,
            whitelist: {
              denyPrefixes: ['6115', '6406'],
              denyChapters: ['64'],
            },
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('WOMEN_LEGGING_KNIT_INTENT: added whitelist (deny hosiery 6115 + footwear 64)');
        } else {
          console.log('WOMEN_LEGGING_KNIT_INTENT: already has whitelist');
        }
      } else {
        console.log('WOMEN_LEGGING_KNIT_INTENT: not found (may not have been applied yet)');
      }
    }

    // UPDATE ANIME_NOVELTY_KEYCHAIN_PLASTIC_INTENT — add whitelist to block metal chapter
    // Problem: "Fire Emblem Keychains" → 7326.20 (metal keychain, ch.73) instead of 3926.90 (plastic)
    // Fix: denyChapters 73 (steel/iron articles) when anime/novelty keychain intent fires
    {
      const existing = allRules.find(r => r.id === 'ANIME_NOVELTY_KEYCHAIN_PLASTIC_INTENT');
      if (existing) {
        const hasWhitelist = !!(existing as any).whitelist;
        if (!hasWhitelist) {
          const updated = {
            ...existing,
            whitelist: {
              denyChapters: ['73', '71'],
            },
          } as IntentRule;
          patches.push({ priority: 568, rule: updated });
          console.log('ANIME_NOVELTY_KEYCHAIN_PLASTIC_INTENT: added whitelist (deny metal ch.73 + precious metals ch.71)');
        } else {
          console.log('ANIME_NOVELTY_KEYCHAIN_PLASTIC_INTENT: already has whitelist');
        }
      } else {
        console.log('ANIME_NOVELTY_KEYCHAIN_PLASTIC_INTENT: not found (may not have been applied yet)');
      }
    }

    // UPDATE SWIMWEAR_WOVEN_INTENT — add whitelist to prefer 6211 over 6112 (knitted swimwear)
    // Problem: "Large Bikini" → 6112.41 (knitted swimwear) but expected 6211.12 (woven)
    // Note: Both are valid swimwear codes; 6112 = knitted, 6211 = not knitted/woven
    // This is borderline - many real items ARE 6112. Don't add denyChapters here.
    // Instead just let the inject+boost work - if it's getting 6112 as top result, that's ok for hit@10.

    console.log(`\nApplying ${patches.length} rule patches (batch TT50)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT50 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
