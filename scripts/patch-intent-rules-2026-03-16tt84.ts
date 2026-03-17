#!/usr/bin/env ts-node
/**
 * Patch TT84 — 2026-03-16: Plastic/acrylic stickers → ch.39, fix sticker label intent.
 *
 * Fixes:
 *  1. UPDATE STICKER_LABEL_INTENT — add noneOf for plastic/acrylic stickers
 *     "Engraved Acrylic Label Stickers" → 4821 (paper labels!) WRONG (expected 3920.59)
 *     "Acrylic bookmarks with printed vinyl stickers" → 4821 WRONG (expected 3906.90)
 *     "1.5x2.5 inch sticker" → 4821 WRONG (expected 3919.90)
 *     BUG: STICKER_LABEL_INTENT has 'vinyl sticker' in anyOf AND injects 4821 (paper)
 *          But vinyl/acrylic/plastic stickers should be ch.39 (self-adhesive plastic strips)
 *     FIX: Add acrylic/plastic sticker terms to noneOf; remove 'vinyl sticker' from anyOf
 *
 *  2. NEW PLASTIC_ADHESIVE_STICKER_INTENT → 3919 (self-adhesive plastic)
 *     "vinyl sticker", "acrylic sticker", "pvc sticker" → ch.39 (3919/3920), deny ch.48
 *     3919.10 = self-adhesive strips of plastic; 3919.90 = other self-adhesive plastic products
 *     3920.59 = sheets of other plastics (for rigid acrylic labels)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt84.ts
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

    // 1. UPDATE STICKER_LABEL_INTENT — add noneOf for plastic/acrylic stickers
    //    "Engraved Acrylic Label Stickers" → 4821 WRONG (expected 3920.59)
    //    BUG: 'sticker' single word in anyOf fires for ALL sticker queries including plastic ones
    //    FIX: Add plastic material terms to noneOf so ch.39 stickers don't get directed to 4821
    {
      const existing = allRules.find(r => r.id === 'STICKER_LABEL_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        // Remove 'vinyl sticker' from anyOf (vinyl = plastic, should go to 3919)
        const filteredAnyOf = currentAnyOf.filter((p: string) => p !== 'vinyl sticker');
        const newNoneOf = [
          ...currentNoneOf,
          // Plastic material stickers → ch.39, not ch.48
          'acrylic sticker', 'acrylic stickers', 'acrylic label',
          'vinyl sticker', 'vinyl stickers', 'vinyl label', 'vinyl labels',
          'pvc sticker', 'pvc stickers', 'pvc label',
          'plastic sticker', 'plastic stickers', 'plastic label sticker',
          'silicone sticker', 'resin sticker',
          'holographic sticker', 'foil sticker',  // these are typically plastic/metallic film
          // Acrylic bookmarks/accessories
          'acrylic bookmark', 'acrylic keychains with stickers',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: filteredAnyOf,
            noneOf: [...new Set(newNoneOf)],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log('STICKER_LABEL_INTENT: removed vinyl sticker from anyOf, added plastic noneOf');
      } else {
        console.log('STICKER_LABEL_INTENT: not found');
      }
    }

    // 2. NEW PLASTIC_ADHESIVE_STICKER_INTENT → 3919/3920 (plastic self-adhesive)
    //    "vinyl sticker" → 3919.90; "acrylic sticker" → 3920.59 (plastic sheets)
    //    "1.5x2.5 inch sticker" → this is ambiguous (no material), keep it going to 4821
    //    FIX: Only target queries that clearly specify plastic material
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_ADHESIVE_STICKER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_ADHESIVE_STICKER_INTENT',
          description: 'Vinyl/acrylic/plastic adhesive stickers and labels → ch.39 (3919/3920)',
          pattern: {
            anyOf: [
              // Vinyl stickers (film/sheet of PVC/polyester)
              'vinyl sticker', 'vinyl stickers', 'vinyl label', 'vinyl labels',
              'vinyl decal', 'vinyl decals', 'die cut vinyl', 'die-cut vinyl',
              'outdoor vinyl sticker', 'waterproof vinyl sticker',
              // Acrylic stickers/labels
              'acrylic sticker', 'acrylic stickers', 'acrylic label sticker',
              'acrylic label', 'acrylic name tag', 'acrylic name sticker',
              // PVC/plastic labels
              'pvc sticker', 'pvc stickers', 'pvc label', 'plastic sticker',
              // Printed vinyl
              'printed vinyl sticker', 'clear vinyl sticker', 'transparent vinyl sticker',
              'glossy vinyl sticker', 'matte vinyl sticker',
              // Holographic/foil (plastic film)
              'holographic sticker', 'holographic stickers', 'holographic decal',
              'foil sticker', 'foil stickers', 'metallic sticker',
              // Bumper stickers (typically vinyl)
              'bumper sticker', 'bumper stickers',
              // Window decals
              'window decal', 'window sticker', 'car decal',
            ],
            noneOf: [
              // Exclude paper stickers
              'paper sticker', 'paper label', 'kraft sticker',
              // Exclude wall decals that are large
              'wall mural', 'large wall decal',
              // Exclude fabric/textile
              'iron on decal', 'heat transfer vinyl',
            ],
          },
          inject: [
            { prefix: '3919.90', syntheticRank: 2 },  // other self-adhesive plastic products
            { prefix: '3919.10', syntheticRank: 4 },  // self-adhesive strips in rolls
            { prefix: '3920.59', syntheticRank: 6 },  // other plastic sheets (acrylic)
            { prefix: '3920.61', syntheticRank: 8 },  // polycarbonate film/sheet
          ],
          whitelist: {
            allowChapters: ['39', '49'],              // plastic OR printed matter (covers decorative stickers)
            denyChapters: ['48'],                     // deny paper labels
          },
          boosts: [
            { delta: 0.80, prefixMatch: '3919.' },
            { delta: 0.70, prefixMatch: '3920.' },
            { delta: 0.40, chapterMatch: '39' },
          ],
          penalties: [
            { delta: 0.65, chapterMatch: '48' },      // penalize paper labels
          ],
        } as IntentRule;
        patches.push({ priority: 554, rule: newRule });
        console.log('PLASTIC_ADHESIVE_STICKER_INTENT: created (vinyl/acrylic stickers → 3919/3920, deny ch.48)');
      } else {
        console.log('PLASTIC_ADHESIVE_STICKER_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT84)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT84 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
