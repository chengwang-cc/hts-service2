#!/usr/bin/env ts-node
/**
 * Patch TT54 — 2026-03-15: Paper chapter (ch.48) fixes.
 * Current: ~34.53% (TT49-TT53 applied)
 *
 * New Rules:
 *  1. MASKING_WASHI_TAPE_PAPER_INTENT → 4811.41 (paper/board coated with adhesive = masking/washi tape)
 *     "masking tape roll" → 3919.10 (plastic self-adhesive) BUG; washi tape → plastic BUG
 *     Fix: inject 4811.41 + denyChapters: ['39'] to block plastic
 *  2. PAPER_ENVELOPE_INTENT → 4817.10 (envelopes of paper/board)
 *     "Foiled Lunar New Year Red Envelopes" → 3204.12 (dyes!) due to "lunar"/"foil"
 *     "Cash Envelopes" → 3204.12 — wrong
 *     Fix: inject 4817.10 + denyChapters: ['32', '22']
 *  3. PAPER_CUP_DISPOSABLE_INTENT → 4823.69 (paper cups/plates)
 *     "paper cups sample" → 6911.10 (ceramic) BUG; "trivia drink coasters" → wrong
 *     "air fryer paper tray" → 4804 (uncoated kraft) BUG
 *     Fix: inject 4823.69 + denyChapters: ['69']
 *  4. PAPER_STICKER_LABEL_INTENT → 4821.10 (printed labels, self-adhesive paper stickers)
 *     "Self Adhesive Printed Stickers" → 4802.55 BUG; "Product Logo Stickers" → 4802.55 BUG
 *     4821.10 = printed labels of paper, whether or not self-adhesive
 *     Fix: inject 4821.10 + denyChapters: ['48'] prefix denyPrefixes: ['4802.5'] to block raw paper
 *  5. PHOTO_ALBUM_INTENT → 4820.50 (albums for photos, stamps, collections)
 *     "Hockey Cards Album" → 9504.40 (games) BUG; "Wedding Photo Album" → EMPTY BUG
 *     Fix: inject 4820.50 + denyChapters: ['95']
 *  6. SEWING_PATTERN_PAPER_INTENT → 4823.90 (other paper articles = paper sewing patterns)
 *     "sewing pattern made of paper" → 6307.90 (textile!) BUG — "sewing" triggers textile
 *     Fix: inject 4823.90 + denyChapters: ['63']
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt54.ts
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

    // 1. MASKING_WASHI_TAPE_PAPER_INTENT → 4811.41 (paper/board coated with adhesive)
    //    "1 masking tape roll | 15mmx5m" → 3919.10.20 (plastic self-adhesive) WRONG
    //    "crafting tape set" → 6308 WRONG; "Decorative Washi Tapes" → 4823.90 WRONG
    //    4811.41 = paper and paperboard coated with adhesive (includes masking tape, washi tape)
    //    vs 3919 = self-adhesive PLASTIC tape
    {
      const existing = allRules.find(r => r.id === 'MASKING_WASHI_TAPE_PAPER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'MASKING_WASHI_TAPE_PAPER_INTENT',
          description: 'Masking tape, washi tape, decorative paper tape rolls → ch.48 (4811.41)',
          pattern: {
            anyOf: [
              // Masking tape (key product)
              'masking tape', 'masking tape roll', 'masking tape rolls',
              // Washi tape (decorative paper tape)
              'washi tape', 'washi tapes', 'decorative washi tape',
              'japanese washi tape', 'washi tape roll', 'washi tape set',
              // Craft/decorative paper tapes
              'crafting tape', 'decorative tape roll', 'paper tape roll',
              'decorative paper tape', 'printed tape roll',
              // Specific product variants
              'painters tape', 'paper masking tape',
            ],
            noneOf: [
              'vinyl tape', 'duct tape', 'electrical tape', 'scotch tape',
              'packing tape', 'packaging tape', 'clear tape',
              'double sided tape', 'foam tape',
            ],
          },
          inject: [
            { prefix: '4811.41', syntheticRank: 5 },
            { prefix: '4811.49', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['39', '83'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '4811.4' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('MASKING_WASHI_TAPE_PAPER_INTENT: created (masking/washi tape → 4811.41)');
      }
    }

    // 2. PAPER_ENVELOPE_INTENT → 4817.10 (envelopes of paper or paperboard)
    //    "10 Pack Foiled Lunar New Year Red Envelopes" → 3204.12 (dyes!) WRONG
    //    "Antique Outlined Florals in Blue Shagun/Cash Envelopes" → 3204.12 WRONG
    //    "20 Pack Foiled Lunar New Year Red Envelopes" → 2005.70 (food!) WRONG
    //    BUG: "lunar"/"foil"/"shagun" triggers dye/food HTS
    //    4817.10 = envelopes of paper or paperboard
    {
      const existing = allRules.find(r => r.id === 'PAPER_ENVELOPE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PAPER_ENVELOPE_INTENT',
          description: 'Paper envelopes, red envelopes, cash envelopes, greeting card envelopes → ch.48 (4817.10)',
          pattern: {
            anyOf: [
              // Standard envelopes
              'paper envelope', 'paper envelopes', 'card envelope', 'card envelopes',
              'greeting card envelope', 'invitation envelope',
              // Decorative/cultural envelopes
              'red envelope', 'red envelopes', 'lunar new year envelope',
              'cash envelope', 'cash envelopes', 'money envelope', 'money envelopes',
              'shagun envelope', 'gift envelope', 'gift envelopes',
              // Envelope liners and related
              'envelope liner', 'envelope liners', 'monogram envelope liner',
              'personalized envelope', 'custom envelope',
              // Holiday envelopes
              'christmas envelope', 'holiday envelope', 'foil envelope',
            ],
            noneOf: [
              'padded envelope', 'bubble envelope', 'bubble mailer',
              'plastic envelope',
            ],
          },
          inject: [
            { prefix: '4817.10', syntheticRank: 5 },
            { prefix: '4817.20', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['32', '22', '20', '06'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '4817.1' }],
        } as IntentRule;
        patches.push({ priority: 572, rule: newRule });
        console.log('PAPER_ENVELOPE_INTENT: created (envelopes → 4817.10)');
      }
    }

    // 3. PAPER_CUP_DISPOSABLE_INTENT → 4823.69 (cups/trays of paper for food/drink)
    //    "paper cups sample" → 6911.10 (ceramic!) WRONG — "cups" triggers ceramic
    //    "OVO Cup McDonalds Limited Edition" → 6912 (ceramic) WRONG
    //    "trivia drink coasters" → 2202.99 (beverages!) WRONG
    //    "air fryer paper tray" → 4804 (kraft paper) WRONG
    //    "Amazing Spider-Man Paper Cups - 9 oz" → ? (needs check)
    //    4823.69 = cups, containers of paper (for food, beverages)
    {
      const existing = allRules.find(r => r.id === 'PAPER_CUP_DISPOSABLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PAPER_CUP_DISPOSABLE_INTENT',
          description: 'Disposable paper cups, plates, trays, paper tableware → ch.48 (4823.69)',
          pattern: {
            anyOf: [
              // Paper cups
              'paper cup', 'paper cups', 'paper drinking cup', 'disposable paper cup',
              'paper coffee cup', 'paper hot cup', 'paper cold cup',
              // Paper plates
              'paper plate', 'paper plates', 'disposable paper plate',
              // Paper trays/bowls
              'paper tray', 'paper trays', 'paper baking tray', 'air fryer paper tray',
              'paper bowl', 'paper bowls', 'paper food tray',
              // Paper drink coasters (paperboard)
              'paper drink coaster', 'paper coaster', 'paper coasters',
              'cardboard coaster', 'cardboard drink coaster',
            ],
            noneOf: [
              'ceramic', 'porcelain', 'plastic cup', 'reusable cup',
              'travel mug', 'thermos', 'metal cup',
            ],
          },
          inject: [
            { prefix: '4823.69', syntheticRank: 5 },
            { prefix: '4823.20', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['69', '22', '20'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '4823.6' }],
        } as IntentRule;
        patches.push({ priority: 572, rule: newRule });
        console.log('PAPER_CUP_DISPOSABLE_INTENT: created (paper cups/plates → 4823.69)');
      }
    }

    // 4. PAPER_STICKER_LABEL_INTENT → 4821.10 (printed labels of paper, self-adhesive stickers)
    //    "Self Adhesive Printed Stickers" → 4802.55 (printing paper) WRONG
    //    "Product Logo Stickers" → 4802.55 WRONG
    //    "Restaurant Logo Stickers" → 4802.55 WRONG
    //    "The Simpsons - Handmade Character Stickers" → 4802.55 WRONG
    //    "Clear stickers with black ink text" → 4802.55 WRONG
    //    "Sticker Sheet (set)" → 4821.90 (close but 4821.10 = self-adhesive preferred)
    //    4821.10 = printed labels of paper or paperboard (whether or not self-adhesive)
    //    4821.90 = non-printed labels
    //    NOTE: NOT for vinyl/plastic stickers (ch.39) or decals (4908.10)
    {
      const existing = allRules.find(r => r.id === 'PAPER_STICKER_LABEL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PAPER_STICKER_LABEL_INTENT',
          description: 'Printed paper stickers, self-adhesive labels, sticker sheets → ch.48 (4821.10)',
          pattern: {
            anyOf: [
              // Sticker sheets and packs
              'sticker sheet', 'sticker sheets', 'sticker pack', 'sticker set',
              'sticker bundle', 'sticker book',
              // Printed labels/logo stickers
              'logo sticker', 'logo stickers', 'printed sticker', 'printed stickers',
              'custom sticker', 'custom stickers', 'personalized sticker',
              // Self-adhesive stickers
              'self adhesive sticker', 'self-adhesive sticker',
              'self adhesive printed sticker', 'adhesive sticker',
              // Character/novelty stickers
              'character sticker', 'handmade sticker', 'art sticker',
              // Gift tags and labels (hang tags)
              'gift tag paper', 'hang tag paper', 'christmas tag paper',
              'christmas tags', 'gift tags twine', 'santa tag', 'holiday tag',
              // Address/name labels
              'address label', 'return address label', 'name label',
              'mailing label', 'shipping label paper',
            ],
            noneOf: [
              // Exclude vinyl/plastic stickers
              'vinyl sticker', 'vinyl decal', 'vinyl wrap',
              // Exclude washi tape (has own rule)
              'washi tape',
              // Exclude name tags (metal/acrylic)
              'metal name tag', 'acrylic name tag', 'engraved name tag',
            ],
          },
          inject: [
            { prefix: '4821.10', syntheticRank: 5 },
            { prefix: '4821.90', syntheticRank: 4 },
          ],
          whitelist: {
            denyPrefixes: ['4802.5', '4802.6'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '4821.1' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('PAPER_STICKER_LABEL_INTENT: created (sticker sheets/printed labels → 4821.10)');
      }
    }

    // 5. PHOTO_ALBUM_SCRAPBOOK_INTENT → 4820.50 (albums for collections)
    //    "Hockey Cards Album" → 9504.40 (games!) WRONG
    //    "Wedding Photo Album" → EMPTY WRONG
    //    "Digital Album + USB" → 8544.42 (cables!) WRONG
    //    "1960s Champagne Jacquard Wedding Photo Album" → EMPTY WRONG
    //    4820.50 = albums for samples or for collections, photo albums
    {
      const existing = allRules.find(r => r.id === 'PHOTO_ALBUM_SCRAPBOOK_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PHOTO_ALBUM_SCRAPBOOK_INTENT',
          description: 'Photo albums, wedding albums, card collection albums, scrapbooks → ch.48 (4820.50)',
          pattern: {
            anyOf: [
              // Photo albums
              'photo album', 'photo albums', 'wedding photo album', 'picture album',
              'wedding album', 'baby photo album', 'memory album',
              // Card/collectible albums
              'hockey cards album', 'trading cards album', 'card collection album',
              'stamp album', 'coin album', 'collectible album',
              // Scrapbooks
              'scrapbook', 'scrapbooks', 'scrapbook album',
              // Memory books
              'memory book', 'guest book',
            ],
            noneOf: [
              'digital album', 'usb album', 'electronic',
            ],
          },
          inject: [
            { prefix: '4820.50', syntheticRank: 5 },
          ],
          whitelist: {
            denyChapters: ['95', '85'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '4820.5' }],
        } as IntentRule;
        patches.push({ priority: 568, rule: newRule });
        console.log('PHOTO_ALBUM_SCRAPBOOK_INTENT: created (photo/card albums → 4820.50)');
      }
    }

    // 6. SEWING_PATTERN_PAPER_INTENT → 4823.90 (other paper articles = paper sewing patterns)
    //    "sewing pattern made of paper" → 6307.90 (textile NES!) WRONG — "sewing" triggers textile
    //    "Rare Butterick 3461 70s Sewing Pattern for Big Hands" → 6307.90 WRONG
    //    4823.90 = other articles of paper/paperboard (includes paper sewing patterns)
    //    Sewing patterns are paper sheets with printed pattern lines, not textile articles
    {
      const existing = allRules.find(r => r.id === 'SEWING_PATTERN_PAPER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SEWING_PATTERN_PAPER_INTENT',
          description: 'Paper sewing patterns (Butterick, Vogue, McCall\'s) → ch.48 (4823.90)',
          pattern: {
            anyOf: [
              // Paper sewing/craft patterns
              'sewing pattern', 'sewing patterns', 'paper sewing pattern',
              'dress pattern', 'clothing pattern paper', 'craft pattern paper',
              'knitting pattern paper', 'crochet pattern paper',
              // Brand-name pattern types
              'butterick pattern', 'vogue pattern', 'mccalls pattern', 'simplicity pattern',
              // Pattern for crafts
              'paper pattern template', 'printable pattern',
            ],
            noneOf: [
              // Fabric patterns (not paper)
              'fabric', 'textile', 'cotton', 'wool', 'yarn',
            ],
          },
          inject: [
            { prefix: '4823.90', syntheticRank: 5 },
          ],
          whitelist: {
            denyChapters: ['63', '61', '62'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '4823.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SEWING_PATTERN_PAPER_INTENT: created (paper sewing patterns → 4823.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT54)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT54 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
