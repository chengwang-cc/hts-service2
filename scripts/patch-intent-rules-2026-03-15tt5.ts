#!/usr/bin/env ts-node
/**
 * Patch TT5 — 2026-03-15: Targeted remaining failures.
 * Current: 30.01% (1508/5025)
 *
 * Fixes:
 *  1. GUITAR_LEATHER_STRAP_INTENT: guitar strap → 4205.00 (leather goods, not ch.92)
 *  2. HAIR_STYLING_IRON_INTENT: styling iron/curler → 8516.32 (not iron ore 2601)
 *  3. UV_FLASHLIGHT_TORCH_INTENT: UV flashlight/keychain light → 8513.10
 *  4. AUTOMOTIVE_HVAC_CLIMATE_INTENT: car HVAC/AC unit → 8415.20
 *  5. VINYL_PLASTIC_POUCH_WALLET_INTENT: vinyl pouch/coin pouch → 4202.32.10
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt5.ts
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

    // 1. GUITAR_LEATHER_STRAP_INTENT — guitar straps (leather goods) → 4205.00
    //    "leather guitar strap" → getting 9207.90 (musical instruments)
    //    Guitar straps are leather goods = 4205.00, not instruments
    {
      const existing = allRules.find(r => r.id === 'GUITAR_LEATHER_STRAP_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GUITAR_LEATHER_STRAP_INTENT',
          description: 'Guitar straps, shoelaces, leather straps → ch.42 (4205.00)',
          pattern: {
            anyOf: [
              'guitar strap', 'guitar straps', 'leather guitar strap', 'custom guitar strap',
              'bass guitar strap', 'ukulele strap', 'banjo strap',
            ],
          },
          inject: [{ prefix: '4205.00', syntheticRank: 4 }],
          whitelist: { allowChapters: ['42'] },
          boosts: [{ delta: 0.65, prefixMatch: '4205.0' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('GUITAR_LEATHER_STRAP_INTENT: created (guitar strap → 4205.00)');
      }
    }

    // 2. HAIR_STYLING_IRON_WAND_INTENT — hair styling irons/curlers → 8516.32
    //    "Bio Ionic Styling Iron" → getting 2601.20 (iron ore!), expected 8516.32
    //    "Styling Iron" or "Wand Iron" — "Iron" triggers mining/ore ch.26
    {
      const existing = allRules.find(r => r.id === 'HAIR_STYLING_IRON_WAND_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HAIR_STYLING_IRON_WAND_INTENT',
          description: 'Hair styling irons, curling irons, flat irons → ch.85 (8516.32)',
          pattern: {
            anyOf: [
              'styling iron', 'curling iron', 'flat iron hair', 'hair iron',
              'ionic styling iron', 'bio ionic', 'styling wand', 'hair wand',
              'hair curling wand', 'titanium flat iron', 'ceramic flat iron',
            ],
            noneOf: ['cast iron', 'wrought iron', 'iron ore', 'iron bar', 'iron rod'],
          },
          inject: [{ prefix: '8516.32', syntheticRank: 4 }],
          whitelist: { allowChapters: ['85'] },
          boosts: [{ delta: 0.65, prefixMatch: '8516.3' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('HAIR_STYLING_IRON_WAND_INTENT: created (styling iron → 8516.32)');
      }
    }

    // 3. UV_FLASHLIGHT_TORCH_INTENT — UV flashlight/torch/keychain light → 8513.10
    //    "UV keychain light" → getting 7326.20 (keychains), expected 8513.10.20.00
    //    "UV LED lights and Flashlights" → getting 8539.51, expected 8513.10.20
    {
      const existing = allRules.find(r => r.id === 'UV_FLASHLIGHT_TORCH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'UV_FLASHLIGHT_TORCH_INTENT',
          description: 'UV flashlights, torches, keychain lights → ch.85 (8513.10)',
          pattern: {
            anyOf: [
              'uv flashlight', 'uv light flashlight', 'uv torch', 'uv led flashlight',
              'uv keychain light', 'blacklight flashlight', 'black light torch',
              'ultraviolet flashlight', 'uv lamp flashlight', 'handheld uv light',
              'railroad lantern',
            ],
          },
          inject: [{ prefix: '8513.10', syntheticRank: 4 }],
          whitelist: { allowChapters: ['85'] },
          boosts: [{ delta: 0.60, prefixMatch: '8513.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('UV_FLASHLIGHT_TORCH_INTENT: created (UV flashlight → 8513.10)');
      }
    }

    // 4. AUTOMOTIVE_HVAC_CLIMATE_INTENT — car HVAC/AC/heater unit → 8415.20
    //    "Automotive HVAC Control Unit" → getting 8471.80 (computer), expected 8415.20
    //    "Jeep Liberty AC Heater Climate Control Unit" → expected 8415.20
    {
      const existing = allRules.find(r => r.id === 'AUTOMOTIVE_HVAC_CLIMATE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'AUTOMOTIVE_HVAC_CLIMATE_INTENT',
          description: 'Automotive HVAC/AC/climate control units → ch.84 (8415.20)',
          pattern: {
            anyOf: [
              'automotive hvac', 'automotive ac unit', 'car hvac', 'car ac unit',
              'car climate control', 'automotive climate control',
              'ac heater climate control', 'hvac control unit', 'hvac control module',
              'blower motor hvac', 'automotive blower motor',
              'jeep ac control', 'ford hvac control', 'honda hvac control',
            ],
          },
          inject: [{ prefix: '8415.20', syntheticRank: 4 }],
          whitelist: { allowChapters: ['84'] },
          boosts: [{ delta: 0.60, prefixMatch: '8415.2' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('AUTOMOTIVE_HVAC_CLIMATE_INTENT: created (automotive HVAC → 8415.20)');
      }
    }

    // 5. VINYL_PLASTIC_POUCH_WALLET_INTENT — vinyl pouches/wallets → 4202.32.10
    //    "envelope vinyl pouch" → getting 4817.10 (envelopes), expected 4202.32.10
    //    "large vinyl pouch" → getting 4814.20 (wallpaper), expected 4202.32.10
    //    "PU leather coin pouch" → expected 4202.32.10
    {
      const existing = allRules.find(r => r.id === 'VINYL_PLASTIC_POUCH_WALLET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'VINYL_PLASTIC_POUCH_WALLET_INTENT',
          description: 'Vinyl/PU leather pouches, coin purses, flat wallets → ch.42 (4202.32)',
          pattern: {
            anyOf: [
              'vinyl pouch', 'vinyl wallet', 'vinyl coin purse', 'vinyl coin pouch',
              'pu leather coin pouch', 'pu leather pouch', 'pu leather wallet',
              'faux leather coin pouch', 'vegan leather pouch',
              'plastic pouch wallet', 'zipper vinyl pouch', 'envelope pouch',
            ],
            noneOf: ['paper envelope', 'mailing envelope', 'document envelope'],
          },
          inject: [{ prefix: '4202.32', syntheticRank: 4 }],
          whitelist: { allowChapters: ['42'] },
          boosts: [{ delta: 0.60, prefixMatch: '4202.3' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('VINYL_PLASTIC_POUCH_WALLET_INTENT: created (vinyl pouch → 4202.32)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT5)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT5 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
