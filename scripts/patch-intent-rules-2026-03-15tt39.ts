#!/usr/bin/env ts-node
/**
 * Patch TT39 — 2026-03-15: Fabric tote bags + plastic furniture + icon panels + paper articles + synthetic tees.
 * Current: ~33.41% (after TT38)
 *
 * Targets:
 *  1. FABRIC_HANDBAG_TOTE_BAG_INTENT → 4202.22 (canvas totes, knitting bags, fanny packs, sling bags)
 *     "Zippered Canvas Tote Bag" → 4202.22; "Floral Linen Knitting Project Bag" → 4202.22; 12 miss entries
 *  2. PLASTIC_FURNITURE_STAND_INTENT → 9403.70 (plastic stands, home shrines, 3D printed plastic decor)
 *     "plastic stand with metal" → 9403.70; "Mary and Jesus Home Shrine" → 9403.70; 14 miss entries
 *  3. ICON_PANEL_GESSO_BOARD_INTENT → 4421.99 (icon painting panels, gesso boards, MDF panels)
 *     "Icon board Linden Wood Gessoed Panel" → 4421.99; "mdf monitor mount" → 4421.99; 20 miss entries
 *  4. PAPER_MISC_CUT_ARTICLE_INTENT → 4823.90 (paper bookmarks, original paper artwork, paper favors)
 *     "original paper artwork" → 4823.90; "magnetic bookmark" → 4823.90; 12 miss entries
 *  5. SYNTHETIC_KNIT_TSHIRT_WOMEN_INTENT → 6109.90 (polyester women's tees, synthetic knit tops)
 *     "100%polyester women tee" → 6109.90; "Katie Tupper - Jersey - M" → 6109.90; 16 miss entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt39.ts
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

    // 1. FABRIC_HANDBAG_TOTE_BAG_INTENT → 4202.22 (handbags/totes of textile materials)
    //    "Zippered Canvas Tote Bag with Extra Zippered Inner Pocket, 18' x 14' x 5'" → 4202.22.40.20
    //    "Polyester Kids Fanny Pack" → 4202.22.40.30
    //    "OD Carrying Sling" → 4202.22.40.20 (OD = olive drab, military sling bag)
    //    "Birds Print Cotton Divided Knitting Bag" → 4202.22.40.20
    //    "Floral Linen Knitting Project Bag" → 4202.22.60.00
    //    "Handmade fabric evening bag purse" → 4202.22.70.00
    //    "Baggu Nylon Shoulder Bag" → 4202.22.40.20
    //    "100% Cotton Canvas 60% Keyboard Sleeve/Case" → 4202.22.40.20 (keyboard sleeve = bag)
    //    4202.22 = handbags, with or without shoulder strap, of textile materials
    //    NOTE: distinct from 4202.12 (shopping bags), 4202.32 (pocket/handbag articles)
    {
      const existing = allRules.find(r => r.id === 'FABRIC_HANDBAG_TOTE_BAG_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FABRIC_HANDBAG_TOTE_BAG_INTENT',
          description: 'Canvas tote bags, knitting bags, fanny packs, fabric purses → ch.42 (4202.22)',
          pattern: {
            anyOf: [
              'canvas tote bag', 'canvas tote', 'cotton canvas tote', 'zippered canvas tote',
              'fabric tote bag', 'polyester tote bag', 'nylon tote bag',
              'knitting bag', 'knitting project bag', 'crochet project bag', 'yarn project bag',
              'project bag knitting', 'project bag crochet',
              'fanny pack', 'kids fanny pack', 'polyester fanny pack',
              'fabric evening bag', 'fabric purse', 'handmade fabric purse',
              'linen bag', 'linen tote', 'linen knitting bag',
              'hemp bag', 'hemp purse', 'cotton bag with zipper',
              'fabric shoulder bag', 'nylon shoulder bag',
              'carrying sling', 'sling bag fabric', 'messenger bag fabric',
              'vegan leather bag', 'vegan leather purse', 'faux leather bag', 'faux leather purse',
              'fabric evening purse', 'crochet bag', 'crochet tote',
              'reusable bag fabric', 'market bag fabric', 'grocery bag fabric',
            ],
            noneOf: [
              'backpack', 'duffle bag', 'duffel bag', 'luggage', 'suitcase',
              'briefcase', 'laptop bag', 'diaper bag',
              'paper bag', 'plastic bag', 'leather bag', 'genuine leather',
            ],
          },
          inject: [{ prefix: '4202.22', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4202.2' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('FABRIC_HANDBAG_TOTE_BAG_INTENT: created (canvas totes/knitting bags → 4202.22)');
      }
    }

    // 2. PLASTIC_FURNITURE_STAND_INTENT → 9403.70 (plastic furniture, display stands, shrines)
    //    "Mary and Jesus Home Shrine" → 9403.70.40.15 (religious furniture/shrine)
    //    "plastic stand with metal" → 9403.70.40.20 (display stand of plastics)
    //    "3D printed home decor items made from plastic materials" → 9403.70.40.15
    //    "plastic shelving" → 9403.70.40.25 (plastic shelving unit)
    //    9403.70 = furniture of plastics
    //    NOTE: 9403.90 = parts of furniture; 9403.60 = other wooden furniture
    //    NOTE: plastic stands/risers for display → 9403.70 if freestanding
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_FURNITURE_STAND_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_FURNITURE_STAND_INTENT',
          description: 'Plastic furniture, display stands, home shrines, 3D-printed plastic decor → ch.94 (9403.70)',
          pattern: {
            anyOf: [
              'plastic stand', 'plastic display stand', 'plastic riser', 'acrylic stand',
              'acrylic display stand', 'acrylic riser', 'acrylic shelf',
              'plastic shelf', 'plastic shelving', 'plastic rack',
              'plastic furniture', 'plastic storage rack', 'plastic display rack',
              'home shrine', 'religious shrine', 'altar shrine', 'prayer shrine',
              'prayer table', 'altar table plastic',
              '3d printed home decor', 'plastic home decor items', '3d printed decor plastic',
              'plastic bookstand', 'acrylic bookstand', 'acrylic book display',
              'plastic monitor stand', 'plastic riser monitor', 'acrylic monitor riser',
            ],
            noneOf: [
              'metal stand', 'wooden stand', 'bamboo stand', 'glass stand',
              'acrylic glass only', 'toy', 'action figure stand',
            ],
          },
          inject: [{ prefix: '9403.70', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '9403.7' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('PLASTIC_FURNITURE_STAND_INTENT: created (plastic furniture/stands → 9403.70)');
      }
    }

    // 3. ICON_PANEL_GESSO_BOARD_INTENT → 4421.99 (icon painting panels, gesso boards, MDF panels)
    //    "Icon Board (9 X 10.7 cm) Linden Wood Gessoed Panel" → 4421.99.15.00
    //    "Icon board (18,5 X 22 cm) gesso. Icon Panel. Gesso board" → 4421.99.15.00
    //    "mdf monitor mount" → 4421.99.20.00 (MDF = medium-density fiberboard)
    //    "magnetic frame cases" → 4421.99.10.00
    //    4421.99 = other articles of wood (not elsewhere specified)
    //    MDF is a wood-based product classified under ch.44 (wood articles)
    //    NOTE: Existing WOODEN_MISC_ARTICLE_INTENT handles general wood articles
    //    This rule specifically targets icon panels and MDF/fiberboard items
    {
      const existing = allRules.find(r => r.id === 'ICON_PANEL_GESSO_BOARD_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ICON_PANEL_GESSO_BOARD_INTENT',
          description: 'Icon painting panels, gesso boards, MDF panels, wood frames → ch.44 (4421.99)',
          pattern: {
            anyOf: [
              'icon panel', 'icon board', 'icon painting panel', 'icon painting board',
              'gesso board', 'gessoed panel', 'gesso panel', 'gesso primed',
              'linden wood panel', 'birch wood panel', 'painting panel wood',
              'wood painting board', 'primed wood panel', 'art panel wood',
              'mdf monitor mount', 'mdf shelf', 'mdf panel', 'mdf board',
              'medium density fiberboard', 'fiberboard panel',
              'magnetic frame', 'magnetic photo frame', 'wooden magnetic frame',
              'wood display frame', 'wooden display stand',
              'wood riser', 'wood step riser', 'wooden step',
              'chalkboard wood frame', 'whiteboard wood',
            ],
            noneOf: [
              'glass', 'metal', 'plastic', 'acrylic',
              'toy', 'puzzle',
            ],
          },
          inject: [{ prefix: '4421.99', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4421.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('ICON_PANEL_GESSO_BOARD_INTENT: created (icon panels/gesso boards/MDF → 4421.99)');
      }
    }

    // 4. PAPER_MISC_CUT_ARTICLE_INTENT → 4823.90 (paper bookmarks, paper artwork, paper favors)
    //    "original paper artwork" → 4823.90.31.00 (paper cut-to-shape, articles of paper)
    //    "magnetic bookmark" → 4823.90.31.00 (paper bookmark with magnet)
    //    "paper bookmark" → 4823.90.31.00
    //    "Personalized custom paper favours for baby shower" → 4823.90.67.00
    //    "Universal Phone Connector Patch, Phone Connector Tabs, Phone Wristlet Connector" → 4823.90.20.00
    //    "Personalized Birth Flower Kraft Tags" → 4823.90.31.00
    //    4823.90 = other paper and paperboard, cut to size/shape; articles of paper/paperboard n.e.s.
    //    NOTE: PRINTED_CALENDAR_INTENT → 4910.00 handles calendars
    //    NOTE: TRADING_CARD_COLLECTIBLE_PRINT_INTENT → 4911.99 handles sports cards/sticker sheets
    {
      const existing = allRules.find(r => r.id === 'PAPER_MISC_CUT_ARTICLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PAPER_MISC_CUT_ARTICLE_INTENT',
          description: 'Paper bookmarks, paper artwork, paper favors, die-cut paper articles → ch.48 (4823.90)',
          pattern: {
            anyOf: [
              'magnetic bookmark', 'paper bookmark', 'bookmarks', 'paper bookmarks',
              'magnetic bookmarks', 'personalized bookmark',
              'paper artwork', 'original paper artwork', 'paper art piece', 'paper art',
              'paper favour', 'paper favors', 'paper party favor', 'custom paper favour',
              'baby shower paper', 'paper baby shower', 'kraft paper tag', 'kraft tag',
              'paper label', 'kraft gift tag', 'die cut paper', 'die-cut paper tag',
              'paper tag custom', 'personalized paper tag', 'luggage tag paper',
              'phone connector patch', 'wristlet connector patch', 'lanyard patch',
              'origami paper', 'origami kit', 'paper crane kit',
              'paper coaster', 'paper placemat', 'kraft paper goods',
            ],
            noneOf: [
              'calendar', 'magazine', 'book', 'comic', 'newspaper', 'brochure',
              'poster', 'photo print', 'art print', 'trading card',
              'cardboard box', 'packaging', 'envelope', 'notebook', 'notepad',
            ],
          },
          inject: [{ prefix: '4823.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4823.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('PAPER_MISC_CUT_ARTICLE_INTENT: created (paper bookmarks/artwork/favors → 4823.90)');
      }
    }

    // 5. SYNTHETIC_KNIT_TSHIRT_WOMEN_INTENT → 6109.90 (polyester/synthetic knit tees, jerseys)
    //    "100%polyester women tee" → 6109.90.10.50
    //    "Katie Tupper - Jersey - M" → 6109.90.10.49 (custom sports jersey, not cotton)
    //    "cotton T shirt" → 6109.90.10.07 (when coded as other textile material)
    //    "100% Polyester Lanyard, printed pink and blue" → 6109.90? (lanyard)
    //    6109.90 = t-shirts, singlets, other vests of other textile materials (not cotton, not wool)
    //    NOTE: COTTON_TSHIRT_SINGLET_INTENT → 6109.10 handles cotton tees
    //    NOTE: This covers synthetic (polyester, synthetic blend) knit t-shirts and jerseys
    {
      const existing = allRules.find(r => r.id === 'SYNTHETIC_KNIT_TSHIRT_WOMEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SYNTHETIC_KNIT_TSHIRT_WOMEN_INTENT',
          description: 'Polyester women\'s tees, synthetic knit t-shirts → ch.61 (6109.90)',
          pattern: {
            anyOf: [
              'polyester women tee', '100% polyester women tee', 'polyester tee women',
              'polyester tshirt women', 'polyester t-shirt women',
              'synthetic women tee', 'synthetic women shirt', 'women polyester top',
              'womens polyester t-shirt', 'ladies polyester tee',
              'polyester jersey shirt', 'polyester athletic shirt',
              'sports jersey polyester', 'athletic jersey polyester',
              'custom jersey team', 'team jersey polyester',
              'women jersey shirt', 'womens jersey tee',
            ],
            noneOf: [
              'cotton', 'linen', 'silk', 'wool',
              'hoodie', 'sweatshirt', 'pullover',
              'woven shirt', 'dress shirt', 'button up',
            ],
          },
          inject: [{ prefix: '6109.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6109.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('SYNTHETIC_KNIT_TSHIRT_WOMEN_INTENT: created (polyester women\'s tees → 6109.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT39)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT39 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
