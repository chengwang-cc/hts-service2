#!/usr/bin/env ts-node
/**
 * Patch TT72b — 2026-03-15: Narrow CHARACTER_KEYCHAIN_PLASTIC_INTENT to require game/character context.
 *
 * Fix:
 *  UPDATE CHARACTER_KEYCHAIN_PLASTIC_INTENT — add anyOfGroups requiring game/anime/character terms
 *  BUG: "keychain round M (pre-owned)" → expected 7326.20.00.90 (metal) but now routes to
 *       3926.90.35 (plastic) because CHARACTER_KEYCHAIN_PLASTIC_INTENT fires for ALL 'keychain'
 *       queries without explicit material keywords — including generic product-code style keychains.
 *  "keychain round M" was previously correct via KEYCHAIN_METAL_INTENT (before TT72 added anyOfGroups)
 *  FIX: Add anyOfGroups with game/anime/character terms so only explicit character keychains trigger.
 *       "keychain round M" has none of these → won't match → organic search returns 7326.xx (correct)
 *       "Omori SMASH Keychains" has "smash" → still matches → 3926.90.35 (correct)
 *       "Fire Emblem 3 Hopes Keychains" has "fire emblem" phrase → still matches → 3926.90.35 (correct)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt72b.ts
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

    // UPDATE CHARACTER_KEYCHAIN_PLASTIC_INTENT — add anyOfGroups for game/character context
    // "keychain round M (pre-owned)" → expected 7326.20 but TT72 caused it to route to 3926.90.35
    // because CHARACTER_KEYCHAIN_PLASTIC_INTENT is too broad (matches any 'keychain' without metal/fabric)
    // FIX: Require at least one game/anime/character/fandom term via anyOfGroups
    //      These terms distinguish "Omori SMASH Keychains" from "keychain round M"
    {
      const existing = allRules.find(r => r.id === 'CHARACTER_KEYCHAIN_PLASTIC_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            // Must have at least one game/anime/character/fandom indicator
            // OR at least one material term indicating plastic/acrylic (as fallback)
            anyOfGroups: [
              [
                // Game franchises and characters
                'smash', 'fire emblem', 'pokemon', 'zelda', 'mario', 'kirby', 'nintendo',
                'sonic', 'megaman', 'capcom', 'sega', 'konami', 'bandai',
                'genshin', 'honkai', 'arknights', 'azur lane', 'fgo', 'fate grand',
                'persona', 'atlus', 'ace attorney',
                'cyberpunk', 'overwatch', 'league of legends', 'valorant', 'apex legends',
                'cs2', 'csgo', 'counter strike',
                'elden ring', 'dark souls', 'sekiro', 'fromsoft',
                'jojo', 'jjba', 'naruto', 'bleach', 'one piece', 'dragon ball',
                'demon slayer', 'attack on titan', 'my hero academia', 'spy x family',
                'hololive', 'nijisanji', 'vtuber', 'vtube', 'cover corp',
                // Generic anime/fandom terms
                'anime', 'manga', 'chibi', 'kawaii', 'waifu', 'husbando', 'gacha',
                'fandom', 'fanart', 'fan art', 'merch', 'merchandise',
                // Art/design terms that indicate custom character art
                'illustration', 'logo', 'inspired', 'character design', 'art print',
                'acrylic charm', 'charm keychain', 'double sided acrylic',
                // Material terms (as a safety net)
                'acrylic', 'resin', 'pvc', 'epoxy resin', '3d printed pla',
              ],
            ],
          },
        } as IntentRule;
        await svc.upsertRule(updated, 475);
        console.log('✅ CHARACTER_KEYCHAIN_PLASTIC_INTENT: added anyOfGroups for game/character context');
        console.log('   "keychain round M" won\'t match; "Omori SMASH Keychains" matches via "smash"');
        console.log('   "Fire Emblem 3 Hopes Keychains" matches via "fire emblem"');
      } else {
        console.log('❌ CHARACTER_KEYCHAIN_PLASTIC_INTENT: not found');
      }
    }

    console.log('\nTT72b complete');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
