#!/usr/bin/env ts-node
/**
 * Patch TT65 — 2026-03-15: Fix fireplace tools, candle holders, sponge holders, balloon garland.
 *
 * Fixes:
 *  1. UPDATE AI_CH69_CERAMIC_MISC_HOUSEHOLD — add '94' to allowChapters
 *     "wooden candle holder" → 6911 (porcelain!) WRONG
 *     BUG: AI_CH69 matches 'candle holder' token, allowChapters blocks 9405.50 (ch.94)
 *     CANDLE_HOLDER_INTENT injects 9405.50 with syntheticRank:22 + boost:0.85, but ch.94
 *     is filtered out by AI_CH69's allowChapters before it can win.
 *     FIX: Add '94' to allowChapters so 9405.50 candle holders can pass through.
 *
 *  2. UPDATE SPONGE_HOLDER_KITCHEN_INTENT — add inject + boosts
 *     "Mustard Checkers Sponge Holder" → EMPTY (expected 6907.40 ceramic)
 *     "Bent Flower Sponge Holder" → EMPTY (expected 6912.00 ceramic)
 *     BUG: Rule exists with allowChapters['69','39','73','94','83'] but no inject/boosts
 *     No candidates from ch.69 score above 0.25 threshold for "sponge holder"
 *     FIX: Add inject for 6912.00, 6907.40 and boost for ch.69
 *
 *  3. UPDATE AI_CH05_IVORY_ANTLER_HORN — add noneOf for tool/fire contexts
 *     "Antique Ember Tongs Coal Gripper Claw Hand Fire Tongs" → 0507.10 (ivory!) WRONG
 *     BUG: 'claw' in anyOf matches "Claw Hand Fire Tongs", injecting 0507.10 (ivory/antler)
 *     syntheticRank:40 injection dominates despite being completely wrong
 *     FIX: Add 'tong', 'tongs', 'gripper', 'scuttle', 'poker', 'bellows' to noneOf
 *
 *  4. NEW FIREPLACE_COAL_HEARTH_TOOL_INTENT → 7321.90 / 8205.59 (fireplace accessories)
 *     "Antique Ember Tongs Coal Gripper" → 0507.10 WRONG (after fix #3, still needs routing)
 *     "Large Antique Brass Coal Scuttle" → expected 7321.89 (stove accessories)
 *     "fireplace bellows" → 7321.89 (already correct, reinforce it)
 *     BUG: "coal" in product name triggers coal fuel chapter (ch.27)
 *     FIX: denyChapters: ['27', '26', '05'], inject 7321.90 + 8205.59
 *
 *  5. NEW BALLOON_GARLAND_ARCH_INTENT → 4016.95 (inflatable rubber articles)
 *     "tuftex Monster Truck Balloon garland" → EMPTY (expected 4016.95)
 *     "tuftex Preppy Balloon Garland" → EMPTY (expected 4016.95)
 *     BUG: BALLOON_INTENT excludes 'balloon garland'/'balloon arch' in noneOf,
 *     leaving these queries without any rule to route them → EMPTY
 *     FIX: Dedicated rule for balloon garlands/arches → rubber inflatable articles
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt65.ts
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

    // 1. UPDATE AI_CH69_CERAMIC_MISC_HOUSEHOLD — add '94' to allowChapters
    //    "wooden candle holder" → 6911 (porcelain!) WRONG
    //    CANDLE_HOLDER_INTENT injects 9405.50 (ch.94) with strong boost, BUT
    //    AI_CH69 fires on 'candle holder' token and allowChapters excludes ch.94 → 9405.50 filtered out
    //    FIX: Add '94' to allowChapters so candle holder 9405.50 injection can win
    {
      const existing = allRules.find(r => r.id === 'AI_CH69_CERAMIC_MISC_HOUSEHOLD');
      if (existing) {
        const currentAllow = (existing as any).whitelist?.allowChapters || [];
        if (!currentAllow.includes('94')) {
          const updated = {
            ...existing,
            whitelist: {
              ...(existing as any).whitelist,
              allowChapters: [...currentAllow, '94'],
            },
          } as IntentRule;
          patches.push({ priority: 0, rule: updated });
          console.log('AI_CH69_CERAMIC_MISC_HOUSEHOLD: added ch.94 to allowChapters (unblocks 9405.50 candle holders)');
        } else {
          console.log('AI_CH69_CERAMIC_MISC_HOUSEHOLD: ch.94 already in allowChapters');
        }
      } else {
        console.log('AI_CH69_CERAMIC_MISC_HOUSEHOLD: not found');
      }
    }

    // 2. UPDATE SPONGE_HOLDER_KITCHEN_INTENT — add inject + boosts
    //    "Mustard Checkers Sponge Holder" → EMPTY (expected 6907.40 ceramic tiles/floors)
    //    "Bent Flower Sponge Holder" → EMPTY (expected 6912.00 ceramic tableware)
    //    Rule exists but has no inject/boosts — nothing from ch.69 scores above 0.25 threshold
    {
      const existing = allRules.find(r => r.id === 'SPONGE_HOLDER_KITCHEN_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '6912.00', syntheticRank: 5 }, // ceramic household articles
            { prefix: '6907.40', syntheticRank: 5 }, // ceramic tiles/accessories
            { prefix: '6914.10', syntheticRank: 4 }, // other ceramic articles
            { prefix: '3924.10', syntheticRank: 4 }, // plastic tableware/kitchenware
          ],
          boosts: [
            { delta: 0.60, prefixMatch: '6912.' },
            { delta: 0.55, prefixMatch: '3924.' },
          ],
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('SPONGE_HOLDER_KITCHEN_INTENT: added inject 6912.00/6907.40 + boosts (fixes EMPTY for sponge holder)');
      } else {
        console.log('SPONGE_HOLDER_KITCHEN_INTENT: not found');
      }
    }

    // 3. UPDATE AI_CH05_IVORY_ANTLER_HORN — add noneOf for tool/fire contexts
    //    "Antique Ember Tongs Coal Gripper Claw Hand Fire Tongs" → 0507.10 (ivory!) WRONG
    //    'claw' in anyOf + syntheticRank:40 injection for ivory dominates the result
    //    'claw' in "Claw Hand Fire Tongs" = mechanical claw/gripper, NOT animal claw
    //    FIX: add tool-context terms to noneOf to prevent ivory injection for tools
    {
      const existing = allRules.find(r => r.id === 'AI_CH05_IVORY_ANTLER_HORN');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const toolNoneOf = ['tong', 'tongs', 'gripper', 'scuttle', 'poker', 'bellows', 'fire tong', 'coal tong', 'ember tong', 'fire poker', 'fire tool'];
        const newNoneOf = [...new Set([...currentNoneOf, ...toolNoneOf])];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: newNoneOf,
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('AI_CH05_IVORY_ANTLER_HORN: added tool noneOf terms (tongs/gripper/scuttle prevent ivory injection)');
      } else {
        console.log('AI_CH05_IVORY_ANTLER_HORN: not found');
      }
    }

    // 4. NEW FIREPLACE_COAL_HEARTH_TOOL_INTENT → 7321.90 / 8205.59
    //    "Antique Ember Tongs Coal Gripper Claw Hand Fire Tongs" → 0507 WRONG (now unblocked after fix #3)
    //    "Large Antique Brass Coal Scuttle" → expected 7321.89 (stove accessories of iron)
    //    BUG: "coal" in product name can trigger coal fuel chapter (ch.27)
    //    7321.89 = other appliances of iron/steel for solid fuels (includes coal scuttles, fire accessories)
    //    8205.59 = other hand tools (including fire tongs, fire pokers)
    {
      const existing = allRules.find(r => r.id === 'FIREPLACE_COAL_HEARTH_TOOL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FIREPLACE_COAL_HEARTH_TOOL_INTENT',
          description: 'Fire tongs, coal scuttles, fireplace pokers, hearth tools → ch.73 (7321.90)',
          pattern: {
            anyOf: [
              // Fire tongs / ember tongs
              'fire tongs', 'coal tongs', 'ember tongs', 'fireplace tongs',
              'log tongs', 'fire gripper', 'coal gripper', 'ember gripper',
              // Coal scuttles and buckets
              'coal scuttle', 'coal bucket', 'log bucket', 'fire scuttle',
              'coal hod', 'fireside scuttle',
              // Fireplace tools
              'fireplace poker', 'fire poker', 'hearth poker',
              'fireplace bellows', 'fire bellows', 'hearth bellows',
              'fireplace shovel', 'hearth shovel', 'ash shovel',
              'fireplace brush', 'hearth brush', 'ash brush',
              // Fireplace tool sets
              'fireplace tool set', 'hearth tool set', 'fireside tool set',
              'fire iron set', 'fireplace accessory',
            ],
            noneOf: [
              'electric', 'gas fireplace', 'electronic',
            ],
          },
          inject: [
            { prefix: '7321.90', syntheticRank: 5 }, // parts/accessories for stoves/ranges
            { prefix: '7321.89', syntheticRank: 5 }, // other appliances for solid fuels
            { prefix: '8205.59', syntheticRank: 4 }, // other hand tools
            { prefix: '8204.11', syntheticRank: 4 }, // non-adjustable spanners/wrenches (fire tongs HTS)
          ],
          whitelist: {
            denyChapters: ['27', '26', '05'],
          },
          boosts: [
            { delta: 0.60, prefixMatch: '7321.' },
            { delta: 0.55, prefixMatch: '8205.' },
          ],
        } as IntentRule;
        patches.push({ priority: 582, rule: newRule });
        console.log('FIREPLACE_COAL_HEARTH_TOOL_INTENT: created (fire tongs/coal scuttle → 7321.90, deny ch.27/26/05)');
      }
    }

    // 5. NEW BALLOON_GARLAND_ARCH_INTENT → 4016.95 (inflatable articles of rubber)
    //    "tuftex Monster Truck Balloon garland|Smash Truck Birthday" → EMPTY (expected 4016.95)
    //    "tuftex Preppy Balloon Garland | Polo Bear Balloons" → EMPTY (expected 4016.95)
    //    BUG: BALLOON_INTENT excludes 'balloon garland' and 'balloon arch' via noneOf
    //    (those were excluded to avoid routing to ch.95 party articles)
    //    But nothing else routes balloon garlands → EMPTY
    //    4016.95 = other inflatable articles of vulcanized rubber (latex balloons, balloon arches)
    {
      const existing = allRules.find(r => r.id === 'BALLOON_GARLAND_ARCH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BALLOON_GARLAND_ARCH_INTENT',
          description: 'Balloon garland kits, balloon arches, balloon chains → ch.40 (4016.95)',
          pattern: {
            anyOf: [
              // Balloon garlands
              'balloon garland', 'balloon garland kit', 'balloon garland arch',
              'balloon garland set', 'balloon garland backdrop',
              'latex balloon garland', 'organic balloon garland',
              // Balloon arches
              'balloon arch', 'balloon arch kit', 'balloon arch set',
              'balloon arch backdrop', 'balloon arch frame',
              // Balloon decoration kits
              'balloon chain', 'balloon column',
              'balloon decoration kit', 'balloon kit party',
              'balloon backdrop kit',
            ],
            noneOf: [
              'hot air balloon', 'weather balloon', 'medical balloon',
            ],
          },
          inject: [
            { prefix: '4016.95', syntheticRank: 5 }, // inflatable rubber articles
            { prefix: '3926.90', syntheticRank: 4 }, // other plastic articles
          ],
          whitelist: {
            allowChapters: ['40', '39', '95', '49'],
          },
          boosts: [{ delta: 0.65, prefixMatch: '4016.9' }],
        } as IntentRule;
        patches.push({ priority: 578, rule: newRule });
        console.log('BALLOON_GARLAND_ARCH_INTENT: created (balloon garland/arch → 4016.95)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT65)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT65 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
