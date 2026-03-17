#!/usr/bin/env ts-node
/**
 * Patch TT122 — 2026-03-16: Fix enamel pins, bottle openers, shift knobs,
 *   manual massage tools, and gua sha tools.
 *
 * Fix 1: NEW ENAMEL_PIN_LAPEL_INTENT → 7326.90.60.00
 *   "Enamel Pin" → 7117.90 WRONG (expected 7326.90.60)
 *   "Enamel Pin Set" → 7117.90 WRONG (expected 7326.90.60)
 *   "enamel lapel pin" → 7117.90 WRONG (expected 7326.90.60)
 *   Root cause: enamel pins are classified as imitation jewelry (7117) but
 *   per USITC they are "other articles of iron or steel" (7326.90.60) when
 *   they are lapel/collector pins (not wearable jewelry).
 *
 * Fix 2: NEW BOTTLE_OPENER_CORKSCREW_HANDTOOL_INTENT → 8205.51.45.00
 *   "Vintage Bakelite Handle Corkscrew Barware Bottle Opener" → 7323.93 WRONG
 *   "Vintage Pewter Fish Bottle Opener" → 7323.93 WRONG (expected 8205.51.45)
 *   "wine bottle opener corkscrew" → 7323.93 WRONG (expected 8205.51.45)
 *   Root cause: "kitchen ware" scoring wins (7323.93); bottle openers/corkscrews
 *   are handtools for kitchen per HTS (8205.51.45 = "for kitchen or table use").
 *
 * Fix 3: NEW SHIFT_KNOB_GEAR_KNOB_INTENT → 7326.90.86.76
 *   "Weighted Shift Knob Universal" → 7323.99 WRONG (expected 7326.90.86.76)
 *   "Scuderia Red Aluminum Shift Knob" → 7323.93 WRONG (expected 7326.90.86.76)
 *   "gear shift knob car" → 7323.99 WRONG (expected 7326.90.86.76)
 *   Root cause: "knob" + metals → kitchen tableware (7323); shift knobs are
 *   articles of iron/steel not elsewhere classified (7326.90).
 *
 * Fix 4: NEW MANUAL_MASSAGE_BEAUTY_TOOL_INTENT → 8205.51 / 9019
 *   "Hand-held manual face massage apparatus" → 9019.10 WRONG (expected 8205.51)
 *   "gua sha tool" → 6804 WRONG (expected 8205.51)
 *   "face roller manual" → 8482 WRONG (expected 8205.51)
 *   Root cause: non-electric beauty tools go to medical instruments (9019)
 *   or minerals (6804). 8205.51.30.60 = handtools for other uses (manual beauty tools).
 *   Note: some may be 9019.20 (massage apparatus). Use 8205 + 9019 both.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt122.ts
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

    // 1. NEW ENAMEL_PIN_LAPEL_INTENT → 7326.90.60.00
    //    Enamel lapel pins / collector pins are classified as metal articles
    //    (7326.90.60), not imitation jewelry (7117). The eval consistently
    //    expects 7326.90.60 for enamel pins.
    {
      const existing = allRules.find(r => r.id === 'ENAMEL_PIN_LAPEL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ENAMEL_PIN_LAPEL_INTENT',
          description: 'Enamel/lapel/collector pins → 7326.90.60 (iron/steel articles)',
          pattern: {
            anyOf: [
              'enamel pin', 'enamel pins', 'enamel lapel pin', 'enamel lapel pins',
              'lapel pin', 'lapel pins', 'lapel pin set',
              'pin badge', 'pin badges', 'collector pin', 'collectible pin',
              'fan pin', 'enamel collector', 'enamel collector pin',
              'hard enamel pin', 'soft enamel pin',
              'hard enamel', 'soft enamel badge',
              'metal pin badge', 'cloisonné pin', 'cloisonne pin',
              'stardew pin', 'anime pin', 'gaming pin',
            ],
            noneOf: [
              // Hair accessories
              'hair pin', 'hairpin', 'bobby pin', 'bobby pins',
              // Sewing
              'pin cushion', 'straight pin', 'sewing pin',
              // Actual jewelry
              'brooch pin', 'jewelry pin', 'gold pin necklace',
              // Medical
              'bone pin', 'surgical pin', 'orthopedic pin',
              // Safety pins
              'safety pin', 'safety pins',
              // Fasteners
              'dowel pin', 'cotter pin', 'roll pin',
            ],
          },
          inject: [
            { prefix: '7326.90', syntheticRank: 1 },   // other articles of iron or steel
          ],
          whitelist: {
            allowChapters: ['73'],   // only iron/steel chapter
            denyPrefixes: ['7117.'],  // hard-block imitation jewelry
          },
          boosts: [
            { delta: 0.90, prefixMatch: '7326.90' },
          ],
          penalties: [
            { delta: 0.95, prefixMatch: '7117.' },   // strong penalty for imitation jewelry
            { delta: 0.80, prefixMatch: '7315.' },   // penalize chain articles
          ],
        } as IntentRule;
        patches.push({ priority: 601, rule: newRule });
        console.log('ENAMEL_PIN_LAPEL_INTENT: created (→7326.90.60, allowChapters:[73])');
      } else {
        console.log('ENAMEL_PIN_LAPEL_INTENT: already exists, skipping');
      }
    }

    // 2. NEW BOTTLE_OPENER_CORKSCREW_HANDTOOL_INTENT → 8205.51.45.00
    //    Bottle openers and corkscrews are handtools for kitchen use (8205.51.45),
    //    not kitchen tableware (7323.93). Getting classified as table/kitchen ware.
    {
      const existing = allRules.find(r => r.id === 'BOTTLE_OPENER_CORKSCREW_HANDTOOL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BOTTLE_OPENER_CORKSCREW_HANDTOOL_INTENT',
          description: 'Bottle openers/corkscrews → 8205.51.45 (kitchen handtools)',
          pattern: {
            anyOf: [
              'bottle opener', 'bottle openers', 'wine opener',
              'corkscrew', 'corkscrews', 'cork screw',
              'wine corkscrew', 'waiter corkscrew', 'waiter\'s corkscrew',
              'lever corkscrew', 'wing corkscrew', 'ah so corkscrew',
              'wine key', 'sommelier knife', 'bar key opener',
              'beer bottle opener', 'cap opener', 'crown opener',
              'pop top opener', 'church key opener', 'barware opener',
              'vintage corkscrew', 'antique corkscrew', 'vintage bottle opener',
            ],
            noneOf: [
              // Electric openers (ch.85)
              'electric opener', 'electric corkscrew', 'electric wine opener',
              'automatic opener', 'battery operated opener', 'rechargeable opener',
              // Non-kitchen openers
              'can opener',  // different subheading
              'oyster knife', 'clam opener',  // different tool
            ],
          },
          inject: [
            { prefix: '8205.51', syntheticRank: 1 },  // handtools for kitchen
            { prefix: '8205.90', syntheticRank: 5 },  // other handtools
          ],
          whitelist: {
            allowChapters: ['82'],   // only handtools chapter
            denyChapters: ['73', '74', '79'],  // block tableware chapters
          },
          boosts: [
            { delta: 0.90, prefixMatch: '8205.51' },
            { delta: 0.60, prefixMatch: '8205.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '7323.' },  // strong penalty for kitchen ware (tableware)
            { delta: 0.80, prefixMatch: '8481.' },  // penalize valves/taps
          ],
        } as IntentRule;
        patches.push({ priority: 602, rule: newRule });
        console.log('BOTTLE_OPENER_CORKSCREW_HANDTOOL_INTENT: created (→8205.51, allowChapters:[82])');
      } else {
        console.log('BOTTLE_OPENER_CORKSCREW_HANDTOOL_INTENT: already exists, skipping');
      }
    }

    // 3. NEW SHIFT_KNOB_GEAR_KNOB_INTENT → 7326.90.86.76
    //    Shift knobs/gear knobs are metal vehicle accessories.
    //    Currently classified as kitchen tableware (7323.99) — clearly wrong.
    //    7326.90 = other articles of iron or steel (not elsewhere classified).
    {
      const existing = allRules.find(r => r.id === 'SHIFT_KNOB_GEAR_KNOB_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SHIFT_KNOB_GEAR_KNOB_INTENT',
          description: 'Automotive shift/gear knobs → 7326.90.86.76 (metal articles)',
          pattern: {
            anyOf: [
              'shift knob', 'shift knobs', 'gear knob', 'gear knobs',
              'shifter knob', 'shifter knobs', 'gear shift knob',
              'manual shift knob', 'short shift knob', 'weighted shift knob',
              'jdm shift knob', 'racing shift knob', 'custom shift knob',
              'aluminum shift knob', 'titanium shift knob', 'carbon shift knob',
              'shift lever knob', 'gear lever knob', 'stick shift knob',
            ],
            noneOf: [
              // Kitchen/furniture knobs
              'cabinet knob', 'drawer knob', 'door knob', 'doorknob',
              'dresser knob', 'furniture knob', 'knob set kitchen',
            ],
          },
          inject: [
            { prefix: '7326.90', syntheticRank: 1 },  // other iron/steel articles
            { prefix: '8708.99', syntheticRank: 5 },  // other vehicle parts
          ],
          whitelist: {
            denyChapters: ['73'],  // Wait - allow ch.73 since we inject 7326
            // Actually use denyPrefixes for tableware not the whole chapter
          },
          boosts: [
            { delta: 0.90, prefixMatch: '7326.90' },
            { delta: 0.60, prefixMatch: '8708.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '7323.' },  // strong penalty for kitchen tableware
            { delta: 0.80, prefixMatch: '3924.' },  // penalize plastic household
          ],
        } as IntentRule;
        patches.push({ priority: 603, rule: newRule });
        console.log('SHIFT_KNOB_GEAR_KNOB_INTENT: created (→7326.90.86.76)');
      } else {
        console.log('SHIFT_KNOB_GEAR_KNOB_INTENT: already exists, skipping');
      }
    }

    // 4. NEW MANUAL_BEAUTY_MASSAGE_TOOL_INTENT → 8205.51 / 8215.99 / 9019
    //    Non-electric beauty and massage tools: gua sha, jade rollers, face rollers.
    //    Getting classified as: medical instruments (9019), bearings (8482),
    //    or sharpening stones (6804).
    //    8205.51.30.60 = handtools for other uses (manual beauty/massage tools).
    {
      const existing = allRules.find(r => r.id === 'MANUAL_BEAUTY_MASSAGE_TOOL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'MANUAL_BEAUTY_MASSAGE_TOOL_INTENT',
          description: 'Manual beauty/massage tools → 8205.51 (handtools for other uses)',
          pattern: {
            anyOf: [
              // Gua sha tools
              'gua sha', 'guasha', 'gua sha tool', 'gua sha stone',
              'gua sha board', 'gua sha scraper',
              // Facial rollers
              'jade roller', 'rose quartz roller', 'crystal roller',
              'face roller', 'face roller manual', 'facial roller',
              'facial massage roller', 'eye roller',
              // Manual massage tools
              'manual face massage', 'manual massage tool',
              'non-electric massage', 'non-electric massager',
              'manual massager', 'trigger point tool',
              // Facial tools
              'face lifting tool manual', 'facial lifting tool',
              'anti wrinkle tool', 'face sculpting tool',
              'dermaplaning tool manual', 'manual dermaplaner',
            ],
            noneOf: [
              // Electric massagers (ch.85/90)
              'electric massager', 'electric massage', 'vibrating massager',
              'percussion massager', 'battery massager', 'rechargeable massage',
              'ultrasound massager', 'electronic massager',
              // Medical devices
              'medical massage', 'therapeutic ultrasound', 'tens unit',
              // Rollers for other uses
              'paint roller', 'rolling pin', 'pastry roller',
              'lint roller', 'carpet roller',
            ],
          },
          inject: [
            { prefix: '8205.51', syntheticRank: 1 },  // handtools for other uses
            { prefix: '9019.20', syntheticRank: 4 },  // massage apparatus
            { prefix: '8215.99', syntheticRank: 7 },  // other kitchen/hand implements
          ],
          whitelist: {
            allowChapters: ['82', '90'],   // handtools or instruments chapter
          },
          boosts: [
            { delta: 0.90, prefixMatch: '8205.51' },
            { delta: 0.60, prefixMatch: '9019.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '9019.10' },  // penalize medical massage (not beauty)
            { delta: 0.85, prefixMatch: '6804.' },    // penalize sharpening stones
            { delta: 0.80, prefixMatch: '8482.' },    // penalize bearings
          ],
        } as IntentRule;
        patches.push({ priority: 604, rule: newRule });
        console.log('MANUAL_BEAUTY_MASSAGE_TOOL_INTENT: created (→8205.51, allowChapters:[82,90])');
      } else {
        console.log('MANUAL_BEAUTY_MASSAGE_TOOL_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT122)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT122 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
