#!/usr/bin/env ts-node
/**
 * Patch TT18 — 2026-03-15: Recorded media + gemstone jewelry + footwear.
 * Current: ~31% (after TT17)
 *
 * Targets:
 *  1. CASSETTE_TAPE_VINYL_VHS_INTENT → 8523.29 (cassette tapes, vinyl records, VHS)
 *     "BASF cassette tapes" → 8523.29.10; "Vinyl - COED" → 8523.29.20
 *     "Bedknobs and Broomsticks VHS" → 8523.29.50; 19 entries in cluster
 *  2. CD_OPTICAL_DISC_MEDIA_INTENT → 8523.49 (CDs, compact discs, music CDs)
 *     "POP Music CD", "cd music retail", "compact disc box set" → 8523.49; 15 entries
 *  3. GEMSTONE_BEAD_JEWELRY_INTENT → 7116.20 (gemstone/pearl jewelry)
 *     "Aquamarine Gemstone Necklace", "Blue Tiger Eye Bracelet", "Turquoise Beads" → 7116.20
 *  4. GOLD_FILLED_CLAD_JEWELRY_INTENT: add '18k gold plated', 'gold plated necklace',
 *     'pvd gold', 'gold filled ring', 'waterproof gold' terms (currently rank 4 but missing terms)
 *  5. PAPER_COASTER_STICKER_INTENT → 4823.90 (paper coasters, frame mats, stickers, bookmarks)
 *     "Cardboard drink coasters", "Picture Frame Mat", "Boxes of stickers" → 4823.90
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt18.ts
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

    const addAnyOf = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, anyOf: [...new Set([...(pat.anyOf ?? []), ...terms])] };
    };

    // 1. CASSETTE_TAPE_VINYL_VHS_INTENT → 8523.29 (magnetic recorded media)
    //    "BASF cassette tapes" → 8523.29.10 (audio cassettes)
    //    "Vinyl - COED" → 8523.29.20 (vinyl records)
    //    "Hikaru Utada - One Last Kiss (Cass, Album)" → 8523.29.40 (cassette albums)
    //    "Scream ( VHS, 1997)" → 8523.29.50 (VHS/videotapes)
    {
      const existing = allRules.find(r => r.id === 'CASSETTE_TAPE_VINYL_VHS_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CASSETTE_TAPE_VINYL_VHS_INTENT',
          description: 'Cassette tapes, vinyl records, VHS video → ch.85 (8523.29)',
          pattern: {
            anyOf: [
              'cassette', 'cassette tape', 'cassette tapes', 'audio cassette', 'audio cassettes',
              'cassette album', 'blank cassette', 'magnetic tape recorded',
              'vinyl record', 'vinyl records', 'vinyl album', 'vinyl lp', 'vinyl lps',
              'lp vinyl', 'record vinyl', 'vinyl pressing',
              'vhs', 'vhs tape', 'vhs cassette', 'vhs movie', 'vhs video', 'betamax', 'beta tape',
              'reel to reel', 'reel tape', 'open reel',
            ],
            noneOf: ['vinyl flooring', 'vinyl floor', 'vinyl decal', 'vinyl sticker', 'vinyl wrap', 'vinyl siding', 'vinyl tablecloth', 'vinyl banner', 'cassette holder', 'cassette organizer'],
          },
          inject: [{ prefix: '8523.29', syntheticRank: 4 }],
          boosts: [{ delta: 0.65, prefixMatch: '8523.2' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('CASSETTE_TAPE_VINYL_VHS_INTENT: created (cassette/vinyl/VHS → 8523.29)');
      }
    }

    // 2. CD_OPTICAL_DISC_MEDIA_INTENT → 8523.49 (CDs, DVDs, optical discs)
    //    "POP Music CD", "cd music retail", "compact disc box set" → 8523.49.20
    //    "video tape movie" → 8523.49? (may overlap with VHS above but different sub-code)
    {
      const existing = allRules.find(r => r.id === 'CD_OPTICAL_DISC_MEDIA_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CD_OPTICAL_DISC_MEDIA_INTENT',
          description: 'CDs, compact discs, DVDs, optical media → ch.85 (8523.49)',
          pattern: {
            anyOf: [
              'cd album', 'audio cd', 'music cd', 'music cd album', 'compact disc',
              'compact disc box set', 'cd box set', 'cd single', 'cd music',
              'dvd movie', 'dvd disc', 'dvd video', 'blu-ray', 'blu ray disc',
              'cd soundtrack', 'soundtrack cd', 'album cd', 'cd collection',
              'digipack cd', 'digipak cd', 'cd digipack', 'cd digipak',
            ],
            noneOf: ['cd player', 'cd drive', 'cd case empty', 'cd sleeve empty', 'disc drive', 'optical drive'],
          },
          inject: [{ prefix: '8523.49', syntheticRank: 4 }],
          boosts: [{ delta: 0.65, prefixMatch: '8523.4' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('CD_OPTICAL_DISC_MEDIA_INTENT: created (CDs/DVDs → 8523.49)');
      }
    }

    // 3. GEMSTONE_BEAD_JEWELRY_INTENT → 7116.20 (semi-precious stone jewelry and beads)
    //    "Aquamarine Gemstone Necklace" → 7116.20.15
    //    "Blue Tiger Eye Stretch Bracelet" → 7116.20.15
    //    "Lapis Lazuli Tumbled Beads" → 7116.20.30
    //    "Natural White Freshwater Pearls" → 7116.20.30
    //    "Turquoise Chips / Beads" → 7116.20.30
    {
      const existing = allRules.find(r => r.id === 'GEMSTONE_BEAD_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GEMSTONE_BEAD_JEWELRY_INTENT',
          description: 'Semi-precious gemstone jewelry and beads, pearls → ch.71 (7116.20)',
          pattern: {
            anyOf: [
              'gemstone necklace', 'gemstone bracelet', 'gemstone earring', 'gemstone pendant',
              'gemstone jewelry', 'gemstone jewellery', 'gemstone bead', 'gemstone beads',
              'semi precious', 'semi-precious', 'semi precious stone', 'gemstone ring',
              'aquamarine', 'amethyst bracelet', 'turquoise bracelet', 'turquoise necklace',
              'lapis lazuli', 'malachite jewelry', 'tigers eye bracelet', 'tiger eye bracelet',
              'tiger eye stretch', 'tigers eye necklace', 'labradorite', 'moonstone jewelry',
              'rose quartz jewelry', 'crystal bracelet gemstone', 'gemstone chip',
              'freshwater pearl', 'freshwater pearls', 'pearl necklace natural',
              'baroque pearl', 'natural pearl', 'seed pearl', 'pearl bracelet natural',
              'turquoise chip', 'turquoise chips', 'turquoise beads', 'stone beads',
              'hamsa necklace', 'evil eye necklace', 'evil eye bracelet',
            ],
            noneOf: ['gold jewelry', '14k', '18k', '10k', 'sterling silver', 'platinum',
                     'costume jewelry', 'acrylic', 'resin', 'plastic bead'],
          },
          inject: [{ prefix: '7116.20', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7116.2' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('GEMSTONE_BEAD_JEWELRY_INTENT: created (gemstone/pearl jewelry → 7116.20)');
      }
    }

    // 4. GOLD_FILLED_CLAD_JEWELRY_INTENT: add gold-plated, PVD, gold-filled ring terms
    //    "18K Gold-Plated Necklace Set" → 7113.20; "Waterproof-18K gold filled stainless steel"
    //    "Gold PVD Sun Signet Ring" → 7117.19 but gold-plated variants → 7113.20
    {
      const e = allRules.find(r => r.id === 'GOLD_FILLED_CLAD_JEWELRY_INTENT');
      if (e) {
        const newPat = addAnyOf(e,
          'gold filled', 'gold-filled', 'gold filled ring', 'gold filled necklace',
          'gold filled bracelet', 'gold filled earring', 'gold filled chain',
          '14k gold filled', '18k gold filled', 'gold plated necklace', 'gold plated bracelet',
          'gold plated ring', 'gold plated earring', 'gold plated chain',
          '18k gold plated', '14k gold plated', 'waterproof gold', 'tarnish free gold',
          'day collar gold', 'gold collar necklace', 'gold filled collar',
        );
        patches.push({ priority: (e as any).priority ?? 565, rule: { ...e, pattern: newPat } });
        console.log('GOLD_FILLED_CLAD_JEWELRY_INTENT: added gold-plated/gold-filled terms');
      }
    }

    // 5. PAPER_COASTER_MAT_STICKER_INTENT → 4823.90 (paper/paperboard articles)
    //    "Cardboard drink coasters" → 4823.90.10; "Picture Frame Mat" → 4823.90.10
    //    "magnetic bookmark" → 4823.90.31; "Boxes of stickers" → 4823.90.86
    //    "Paper Favours" → 4823.90.67
    {
      const existing = allRules.find(r => r.id === 'PAPER_COASTER_MAT_STICKER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PAPER_COASTER_MAT_STICKER_INTENT',
          description: 'Paper coasters, frame mats, stickers, bookmarks, paper favors → ch.48 (4823.90)',
          pattern: {
            anyOf: [
              'cardboard coaster', 'paper coaster', 'cardboard drink coaster', 'pulp coaster',
              'picture frame mat', 'frame mat', 'picture mat', 'matboard', 'mat board',
              'photo mat', 'acid free mat', 'picture matte', 'frame matte',
              'magnetic bookmark', 'paper bookmark', 'cardboard bookmark',
              'sticker box', 'boxes of stickers', 'sticker pack box', 'sticker collection',
              'paper favor', 'paper favors', 'paper favour', 'paper favours',
              'paper wedding favor', 'paper baby shower', 'paper confetti bag',
              'cardstock die cut', 'paper die cut', 'scrapbook paper set',
            ],
            noneOf: ['vinyl sticker', 'clear sticker', 'holographic sticker', 'sticker sheet', 'laptop sticker'],
          },
          inject: [{ prefix: '4823.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.45, prefixMatch: '4823.9' }],
        } as IntentRule;
        patches.push({ priority: 555, rule: newRule });
        console.log('PAPER_COASTER_MAT_STICKER_INTENT: created (paper coasters/mats/favors → 4823.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT18)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT18 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
