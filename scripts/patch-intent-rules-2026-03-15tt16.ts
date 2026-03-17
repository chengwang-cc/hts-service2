#!/usr/bin/env ts-node
/**
 * Patch TT16 — 2026-03-15: Notebooks/journals + religious jewelry + misc fixes.
 * Current: 30.89% (1552/5025)
 *
 * Targets:
 *  1. NOTEBOOK_JOURNAL_PLANNER_INTENT → 4820.10 (journals, notepads, planners, sticky notes)
 *     "paper tracker notepads" → 4802; "Celestial Journal" → 4901 (books); etc.
 *  2. ROSARY_RELIGIOUS_JEWELRY_INTENT → 7117.90 (rosary, miraculous medal, religious medals)
 *     "Personalized wood bead rosary" → 4409 (wood); "miraculous medal" → ?
 *  3. ENAMEL_PIN_BADGE_INTENT → 7117.90 (enamel pins, collectible pins, pin badges)
 *     "Hazbin Hotel Alastor CATBOY Pin" → 9504 (games)
 *  4. COSTUME_JEWELRY_FASHION_INTENT → 7117.90 (costume/fashion jewelry, imitation jewelry)
 *  5. PLASTIC_KEYCHAIN_ACCESSORY_INTENT → 7117.90.75 (3D printed/plastic keychains as jewelry)
 *     vs KEYCHAIN_INTENT which routes to 7326.20 (metal)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt16.ts
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

    // 1. NOTEBOOK_JOURNAL_PLANNER_INTENT — notebooks, journals, notepads, planners → 4820.10
    //    "paper tracker notepads" → 4802; "Celestial Journal" → 4901; "Sticky Notepad" → 0106
    {
      const existing = allRules.find(r => r.id === 'NOTEBOOK_JOURNAL_PLANNER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'NOTEBOOK_JOURNAL_PLANNER_INTENT',
          description: 'Notebooks, journals, notepads, planners, sticky notes → ch.48 (4820.10)',
          pattern: {
            anyOf: [
              'notepad', 'notepads', 'sticky note', 'sticky notepad', 'post-it notepad',
              'post it notepad', 'paper notepad', 'tracker notepad',
              'journal book', 'blank journal', 'lined journal', 'hardcover journal',
              'celestial journal', 'leather journal', 'pu leather journal',
              'planner journal', 'planner book', 'weekly planner', 'daily planner',
              'coil bound journal', 'spiral journal', 'ring-bound notebook',
              'vow book', 'vow books', 'letterpress journal', 'paper journal',
            ],
            noneOf: ['book shelf', 'book case', 'book cover', 'recipe book', 'comic book', 'manga'],
          },
          inject: [{ prefix: '4820.10', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '4820.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('NOTEBOOK_JOURNAL_PLANNER_INTENT: created (notepads/journals → 4820.10)');
      }
    }

    // 2. ROSARY_RELIGIOUS_JEWELRY_INTENT — rosary beads, miraculous medals → 7117.90
    //    "Personalized wood bead rosary" → 4409 (wood); "miraculous medal necklace" → ?
    {
      const existing = allRules.find(r => r.id === 'ROSARY_RELIGIOUS_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ROSARY_RELIGIOUS_JEWELRY_INTENT',
          description: 'Rosary beads, miraculous medals, religious costume jewelry → ch.71 (7117.90)',
          pattern: {
            anyOf: [
              'rosary', 'rosary beads', 'wood bead rosary', 'bead rosary', 'rosary marker',
              'rosary markers', 'rosary necklace', 'chaplet', 'decade rosary',
              'miraculous medal', 'miraculous medal necklace', 'miraculous medal necklace',
              'saint medal', 'saint medal necklace', 'religious medal', 'religious medal necklace',
              'confirmation medal', 'patron saint medal',
            ],
          },
          inject: [{ prefix: '7117.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7117.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('ROSARY_RELIGIOUS_JEWELRY_INTENT: created (rosary/religious medal → 7117.90)');
      }
    }

    // 3. ENAMEL_PIN_BADGE_JEWELRY_INTENT — enamel pins, collectible pins → 7117.90
    //    "Hazbin Hotel CATBOY Pin" → 9504; enamel pin badges → 7117.90.55
    {
      const existing = allRules.find(r => r.id === 'ENAMEL_PIN_BADGE_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ENAMEL_PIN_BADGE_JEWELRY_INTENT',
          description: 'Enamel pins, collectible pin badges → ch.71 (7117.90)',
          pattern: {
            anyOf: [
              'enamel pin', 'enamel pins', 'hard enamel pin', 'soft enamel pin',
              'lapel pin', 'lapel pins', 'collectible pin', 'pin badge',
              'flair pin', 'anime pin', 'character enamel pin', 'art enamel pin',
              'dust plug charm', 'phone charm dust plug',
            ],
            noneOf: ['safety pin', 'bobby pin', 'hair pin', 'stick pin jewelry', 'tie pin'],
          },
          inject: [{ prefix: '7117.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '7117.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('ENAMEL_PIN_BADGE_JEWELRY_INTENT: created (enamel pins → 7117.90)');
      }
    }

    // 4. COSTUME_FASHION_JEWELRY_INTENT — costume/fashion jewelry, imitation jewelry → 7117.90
    //    "Imitation Acrylic Jewelry Brooch" → 7117.90.60; "costume jewellery" → 7117.90
    {
      const existing = allRules.find(r => r.id === 'COSTUME_FASHION_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COSTUME_FASHION_JEWELRY_INTENT',
          description: 'Costume/fashion jewelry, imitation jewelry → ch.71 (7117.90)',
          pattern: {
            anyOf: [
              'costume jewellery', 'costume jewelry', 'fashion jewelry bracelet',
              'fashion jewellery', 'imitation jewelry', 'imitation jewellery',
              'acrylic jewelry', 'acrylic jewellery', 'imitation acrylic jewelry',
              'resin jewelry', 'resin jewellery', 'plastic jewelry', 'plastic jewellery',
              'kada bracelet', 'steel bangle', 'kada bangle',
            ],
            noneOf: ['solid gold', 'sterling silver', '14k', '18k', 'fine jewelry', 'precious metal'],
          },
          inject: [{ prefix: '7117.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7117.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('COSTUME_FASHION_JEWELRY_INTENT: created (costume/fashion jewelry → 7117.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT16)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT16 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
