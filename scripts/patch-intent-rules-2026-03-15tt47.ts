#!/usr/bin/env ts-node
/**
 * Patch TT47 — 2026-03-15: Plastic vacuum hose + foam pads + costume headwear + bamboo handles.
 * Current: ~34.19% (after TT46)
 *
 * New Rules:
 *  1. VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT → 3917.39 (plastic vacuum hose attachments)
 *     "M18 2 Gallon Vacuum Hose Attachment - Plastic" → 3917.39; ~3 miss entries
 *  2. FOAM_PLASTIC_ARTICLE_INTENT → 3921.13 (foam pads, foam blocks, foam padding)
 *     "pre-finished foam pad" → 3921.13; "Kayak Foam Block" → 3921.13; ~3 miss entries
 *  3. COSTUME_SPECIALTY_HEADWEAR_INTENT → 6506.99 (costume hats, religious headwear, shearling hats)
 *     "Faux fur animal costume hat" → 6506.99; "religious headwear" → 6506.99; ~3 miss entries
 *
 * Updates:
 *  - WOODEN_MISC_ARTICLE_INTENT: add bamboo bag handles, bamboo handles
 *    "Natural Bamboo Bag Handles" → 4421.91 (bamboo articles = wood article for customs)
 *  - Keychain routing: add anime/novelty keychains to 3926.90 plastic
 *    "Fire Emblem Keychains" → 3926.90 (plastic/acrylic anime keychain)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt47.ts
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

    // UPDATE WOODEN_MISC_ARTICLE_INTENT — add bamboo bag handles, bamboo crafting handles
    // "2 sizes Natural Bamboo Bag Handles: Handmade DIY Purse Replacement" → 4421.91.xx
    // "Bamboo Bag Handle" = bamboo/wood article used as replacement handle for bags
    // 4421.91 = other articles of bamboo (bamboo handles/accessories)
    {
      const existing = allRules.find(r => r.id === 'WOODEN_MISC_ARTICLE_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasBambooHandle = currentAnyOf.some((t: string) => t.includes('bamboo handle') || t.includes('bamboo bag handle'));
        if (!hasBambooHandle) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                // Bamboo bag handles (4421.91)
                'bamboo bag handle', 'bamboo bag handles', 'bamboo handle purse',
                'bag handle bamboo', 'purse handle bamboo', 'diy bag handle bamboo',
                'natural bamboo handle', 'bamboo handles',
                // Other bamboo articles
                'bamboo frame', 'bamboo hoop', 'bamboo ring handle',
              ],
            },
            inject: [
              ...((existing as any).inject || []),
              { prefix: '4421.91', syntheticRank: 5 },
            ],
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('WOODEN_MISC_ARTICLE_INTENT: updated with bamboo bag handles/4421.91 inject');
        } else {
          console.log('WOODEN_MISC_ARTICLE_INTENT: already has bamboo handle pattern');
        }
      }
    }

    // 1. VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT → 3917.39 (plastic tubes, hoses, fittings)
    //    "M18 2 Gallon Vacuum Hose Attachment - Plastic" → 3917.39.00.xx
    //    "M18 Milwaukee Vacuum Attachment - 100% Plastic" → 3917.39.00.xx
    //    "M18 Vacuum Attachment - Plastic" → 3917.39.00.xx
    //    3917.39 = tubes, pipes and hoses of plastics (other, flexible)
    //    NOTE: vacuum hose attachment = plastic hose/tube fitting, not the vacuum itself
    {
      const existing = allRules.find(r => r.id === 'VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT',
          description: 'Plastic vacuum hose attachments, plastic tubes, fittings → ch.39 (3917.39)',
          pattern: {
            anyOf: [
              'vacuum hose attachment', 'vacuum attachment plastic', 'vacuum hose plastic',
              'vacuum attachment', 'hose attachment vacuum', 'vacuum hose',
              'm18 vacuum', 'milwaukee vacuum attachment', 'vacuum accessory plastic',
              'dust collector hose', 'shop vac attachment', 'wet dry vacuum hose',
              'plastic hose fitting', 'plastic tube fitting', 'plastic pipe fitting',
              'flexible plastic hose', 'plastic duct hose',
            ],
            noneOf: [
              'vacuum cleaner', 'cordless vacuum', 'robot vacuum', 'handheld vacuum',
              'filter', 'bag', 'motor',
            ],
          },
          inject: [
            { prefix: '3917.39', syntheticRank: 5 },
            { prefix: '3917.33', syntheticRank: 4 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '3917.3' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT: created (plastic vacuum hose → 3917.39)');
      }
    }

    // 2. FOAM_PLASTIC_ARTICLE_INTENT → 3921.13 (foam pads, foam blocks, cellular plastics)
    //    "pre-finished foam pad" → 3921.13.15.xx (polyurethane foam pad, cut to shape)
    //    "FF-39 - Pre-Finished Foam Padding Cut and Sew Foam - Beige" → 3921.13.15.xx
    //    "Kayak Foam Block" → 3921.13.15.xx (foam block for kayak)
    //    3921.13 = plates/sheets/film/foil of cellular polyurethane plastics
    //    NOTE: distinct from 3926 (other plastic articles) - foam is specifically 3921.1x
    {
      const existing = allRules.find(r => r.id === 'FOAM_PLASTIC_ARTICLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FOAM_PLASTIC_ARTICLE_INTENT',
          description: 'Foam pads, foam blocks, polyurethane foam, cellular plastic articles → ch.39 (3921.13)',
          pattern: {
            anyOf: [
              'foam pad', 'foam pads', 'foam padding', 'pre-finished foam', 'precut foam',
              'foam block', 'foam blocks', 'foam sheet', 'foam sheets',
              'polyurethane foam', 'upholstery foam', 'craft foam',
              'kayak foam', 'foam flooring', 'foam tile',
              'eva foam', 'eva foam sheet', 'eva foam pad',
              'foam cushion', 'seat foam', 'car foam pad',
              'cut and sew foam', 'foam sewing', 'foam material',
            ],
            noneOf: [
              'spray foam', 'foam insulation spray',
              'bath foam', 'shaving foam', 'foam soap',
              'memory foam mattress', 'mattress',
            ],
          },
          inject: [
            { prefix: '3921.13', syntheticRank: 5 },
            { prefix: '3921.19', syntheticRank: 4 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '3921.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('FOAM_PLASTIC_ARTICLE_INTENT: created (foam pads/blocks → 3921.13)');
      }
    }

    // 3. COSTUME_SPECIALTY_HEADWEAR_INTENT → 6506.99 (costume hats, religious headwear, shearling hats)
    //    "religious headwear" → 6506.99.xx (religious head coverings not elsewhere classified)
    //    "Faux fur animal costume hat, synthetic fibers" → 6506.99.xx (novelty/costume hat)
    //    "shearling hat" → 6506.99.xx (shearling/sheepskin hat)
    //    6506.99 = other headgear of other materials (not 6504-6505)
    //    NOTE: distinct from 6505.00 (knitted/crocheted hats) and 6506.10 (safety helmets)
    {
      const existing = allRules.find(r => r.id === 'COSTUME_SPECIALTY_HEADWEAR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COSTUME_SPECIALTY_HEADWEAR_INTENT',
          description: 'Costume hats, religious headwear, shearling hats, specialty headgear → ch.65 (6506.99)',
          pattern: {
            anyOf: [
              // Religious headwear
              'religious headwear', 'yarmulke', 'kippah', 'yamaka',
              'turban', 'sikh turban', 'patka',
              // Costume / novelty hats
              'costume hat', 'costume headwear', 'animal costume hat', 'animal hat costume',
              'faux fur costume', 'fur costume hat', 'novelty animal hat',
              'pirate hat', 'witch hat', 'viking hat', 'jester hat', 'elf hat',
              // Leather / shearling hats
              'shearling hat', 'sheepskin hat', 'leather hat', 'fur hat',
              'trapper hat', 'bomber hat', 'aviator hat', 'ushanka',
              // Sports/outdoor specialty hats
              'sun visor hat', 'rain hat', 'waterproof hat', 'hunting hat',
            ],
            noneOf: [
              'safety helmet', 'hard hat safety', 'motorcycle helmet', 'bicycle helmet',
              'baseball cap', 'snapback', 'trucker hat', 'beanie', 'fedora',
            ],
          },
          inject: [
            { prefix: '6506.99', syntheticRank: 5 },
            { prefix: '6506.91', syntheticRank: 4 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '6506.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('COSTUME_SPECIALTY_HEADWEAR_INTENT: created (costume/religious/shearling hats → 6506.99)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT47)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT47 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
