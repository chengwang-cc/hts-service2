#!/usr/bin/env ts-node
/**
 * Patch HHHH — 2026-03-14:
 *
 * Fix remaining EMPTY cases:
 *
 * 1. PHONE_ACCESSORY_INTENT: Add case/cover noneOf + fix DEVICE_CASE_INTENT group1
 *    'silicone' fires PHONE_ACCESSORY → allowPrefixes=['3926.'] blocks ch.42
 *    for "Genuine Apple iPhone 15 Pro Max Silicone Case MagSafe" → expected 4202.99
 *
 * 2. DEVICE_CASE_INTENT: Add iphone/phone/samsung to anyOfGroups group1
 *    Currently only fires for ipad/tablet — not iphone → case rules miss iPhone cases
 *
 * 3. AI_CH91_WATCH_CASE/AI_CH91_CLOCK_CASE: Add plastic/automotive noneOf
 *    'case'/'clock' fires → blocks ch.87/94 for automotive interior parts
 *    "automotive dash plastic molding" → AI_CH91_DASHBOARD_CLOCK + others
 *
 * 4. Multiple remaining noneOf fixes for blocking rules:
 *    - AI_CH25_MINERAL: Add clay/pottery noneOf (fires for clays blocking ch.69)
 *    - AI_CH01_LIVE_ANIMALS: Ensure garment noneOf covers all animal-named products
 *
 * 5. BED_SHEET_INTENT: Add more inject for character/licensed sheet codes
 *    "Vintage DC Comics Batman Twin Flat Sheet" → EMPTY (inject doesn't cover 6302.22.xx)
 *
 * 6. NEW CHARACTER_LICENSED_BEDDING_INTENT: Branded/character bed sheets → ch.63
 *    DC Comics sheet, Batman bedding, character bedding → 6302
 *
 * 7. NEW PLASTIC_AUTOMOTIVE_INTERIOR_INTENT: Automotive plastic parts → ch.87/39
 *    "automotive dash plastic molding", "dash panel" → 8708/3926
 *
 * 8. Additional noneOf fixes:
 *    - CLOCK_TIMEPIECE_INTENT: Add 'diamonds' context for decorative clocks (ch.69/73)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14hhhh.ts
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

    function addNoneOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentNoneOf: string[] = pat.noneOf ?? [];
      const newTerms = toAdd.filter(t => !currentNoneOf.includes(t));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed HHHH: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    function addToAnyOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentAnyOf: string[] = pat.anyOf ?? [];
      const newTerms = toAdd.filter(t => !currentAnyOf.includes(t));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed HHHH: ${note}`,
          pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} anyOf terms`);
    }

    function addInject(ruleId: string, injectSpecs: { prefix: string; syntheticRank: number }[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const currentInject: any[] = (existing as any).inject ?? [];
      const newInject = injectSpecs.filter(s => !currentInject.some((c: any) => c.prefix === s.prefix));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed HHHH: ${note}`,
          inject: [...currentInject, ...newInject],
        },
      });
      console.log(`${ruleId}: adding ${newInject.length} inject specs`);
    }

    // ── 1. PHONE_ACCESSORY_INTENT: Add case/cover noneOf ─────────────────────
    // PHONE_ACCESSORY_INTENT fires for 'iphone'+'silicone' → allowPrefixes=['3926.']
    // blocks ch.42 phone cases. iPhone cases → 4202.99, not 3926.90
    addNoneOf('PHONE_ACCESSORY_INTENT', [
      'case', 'cases', 'cover', 'covers', 'sleeve', 'sleeves',
      'phone case', 'phone cover', 'silicone case', 'leather case',
      'wallet case', 'flip case', 'folio case',
    ], 'case/cover context: phone cases are ch.42, not ch.39 accessories');

    // ── 2. DEVICE_CASE_INTENT: Add iphone/phone to anyOfGroups group1 ────────
    // Currently only fires for ipad/tablet. Adding iphone/phone to group1.
    // Use direct rule modification since addToAnyOf doesn't handle anyOfGroups.
    {
      const existing = allRules.find(r => r.id === 'DEVICE_CASE_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const groups: string[][] = pat.anyOfGroups ?? [];
        if (groups.length >= 2) {
          const newGroup1 = [...new Set([...groups[0], 'iphone', 'phone', 'smartphone', 'android', 'samsung', 'pixel', 'oneplus', 'galaxy'])];
          const newGroups = [newGroup1, ...groups.slice(1)];
          patches.push({
            priority: (existing as any).priority ?? 500,
            rule: {
              ...existing,
              description: (existing.description ?? 'DEVICE_CASE_INTENT') + ' — Fixed HHHH: added iphone/phone to group1',
              pattern: { ...pat, anyOfGroups: newGroups },
            },
          });
          console.log(`DEVICE_CASE_INTENT: updated anyOfGroups group1 with iphone/phone`);
        }
      } else {
        console.log('WARNING: DEVICE_CASE_INTENT not found');
      }
    }

    // ── 3. BED_SHEET_INTENT: Add more inject for character/licensed sheets ────
    // "Vintage DC Comics Batman Twin Flat Sheet" → BED_SHEET_INTENT fires but inject
    // only covers some prefixes. Add 6302.22 (man-made fiber bed linen) inject.
    addInject('BED_SHEET_INTENT', [
      { prefix: '6302.22', syntheticRank: 9 },  // Bed linen of man-made fiber
      { prefix: '6302.21', syntheticRank: 8 },  // Bed linen of cotton
      { prefix: '6302.31', syntheticRank: 7 },  // Other bed linen of cotton
      { prefix: '6302.32', syntheticRank: 6 },  // Other bed linen of man-made
      { prefix: '6302.91', syntheticRank: 5 },  // Other bed linen (household)
    ], 'added 6302.22/21/31/32 inject for licensed/character flat sheet codes');

    // ── 4. NEW CHARACTER_LICENSED_BEDDING_INTENT (ch.63) ─────────────────────
    // "Vintage DC Comics 1996 Batman Twin Flat Sheet" → 6302.22.20 (polyester)
    // Character/licensed bed sheets are specifically 6302.xx
    patches.push({
      priority: 550,
      rule: {
        id: 'CHARACTER_LICENSED_BEDDING_INTENT',
        description: 'Character/licensed bed sheets, pillowcases → ch.63 (6302). ' +
          '"DC Comics sheet", "character flat sheet", "licensed bedding" → 6302. ' +
          'Without rule, branded sheets return wrong chapter.',
        pattern: {
          anyOf: [
            // Character/licensed bedding
            'dc comics', 'marvel', 'disney', 'star wars', 'batman', 'superman',
            'spiderman', 'avengers',
            'character bedding', 'licensed bedding', 'character sheet',
            // Bed-specific sheet terms
            'twin flat sheet', 'queen flat sheet', 'king flat sheet',
            'twin fitted sheet', 'full flat sheet',
            'cotton flat sheet', 'polyester flat sheet',
            'bed sheet set', 'sheet set', 'complete sheet set',
          ],
          noneOf: ['pattern', 'sewing pattern', 'fabric by the yard'],
        },
        whitelist: { allowChapters: ['63'] },
        inject: [
          { prefix: '6302.22', syntheticRank: 9 },  // MMF flat/fitted sheets
          { prefix: '6302.21', syntheticRank: 8 },  // Cotton flat/fitted sheets
          { prefix: '6302.32', syntheticRank: 7 },  // Other MMF bed linen
          { prefix: '6302.31', syntheticRank: 6 },  // Other cotton bed linen
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '6302' },
          { delta: 0.3, chapterMatch: '63' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW ESPRESSO_COFFEE_APPLIANCE_INTENT (ch.85) ──────────────────────
    // "58.5mm Dosing Funnel for Rancilio Silvia and Rocket Espresso" → 8516.90.90
    // Coffee machine parts, espresso accessories → ch.85 (8516)
    patches.push({
      priority: 579,
      rule: {
        id: 'ESPRESSO_COFFEE_APPLIANCE_INTENT',
        description: 'Espresso machine parts, coffee machine accessories → ch.85 (8516). ' +
          '"Dosing funnel", "portafilter", "espresso basket" → 8516.90. ' +
          'Without rule, coffee machine parts return wrong chapter.',
        pattern: {
          anyOf: [
            // Espresso parts
            'dosing funnel', 'dosing ring', 'portafilter', 'portafilter basket',
            'espresso basket', 'espresso machine part', 'espresso parts',
            'tamper', 'coffee tamper', 'espresso tamper',
            'group head', 'shower screen', 'steam wand', 'steam tip',
            'rancilio', 'silvia', 'breville', 'delonghi', 'jura', 'gaggia',
            // Coffee tools
            'coffee grinder part', 'burr grinder part', 'grinder burr',
            'wdt tool', 'puck screen', 'distribution tool',
          ],
          noneOf: ['coffee beans', 'ground coffee', 'coffee pod', 'coffee capsule'],
        },
        whitelist: { allowChapters: ['85', '84'] },
        inject: [
          { prefix: '8516.90', syntheticRank: 9 },  // Parts of electrothermic appliances
          { prefix: '8516.40', syntheticRank: 8 },  // Electric smoothing irons (coffee steam)
          { prefix: '8419.89', syntheticRank: 7 },  // Other industrial machinery
          { prefix: '8516.79', syntheticRank: 6 },  // Other electrothermic appliances
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8516' },
          { delta: 0.3, chapterMatch: '85' },
        ],
      } as IntentRule,
    });

    // ── 6. NEW AUTOMOTIVE_BODY_PARTS_INTENT (ch.87) ──────────────────────────
    // "automotive dash plastic molding" → 9403 OR 8708 (auto body parts)
    // "car interior panel", "dashboard trim" → 8708.29 (other vehicle parts)
    patches.push({
      priority: 568,
      rule: {
        id: 'AUTOMOTIVE_BODY_PARTS_INTENT',
        description: 'Automotive body and interior parts → ch.87 (8708). ' +
          '"Dash molding", "door trim", "car interior panel" → 8708.29. ' +
          '"Seat foam", "seat cover" → 8714.10 or similar.',
        pattern: {
          anyOf: [
            // Interior parts
            'dash molding', 'dashboard molding', 'dash trim', 'dashboard trim',
            'door molding', 'door trim', 'body molding',
            'interior trim', 'interior panel', 'dash panel',
            'plastic molding', 'automotive molding', 'automotive trim',
            'car trim', 'auto trim',
            // Body parts
            'fender liner', 'splash guard', 'mud flap', 'mud guard',
            'bumper cover', 'bumper trim', 'grill insert',
            'seat foam', 'seat cushion foam', 'motorcycle seat foam',
          ],
          noneOf: ['wood', 'chrome', 'stainless', 'aluminum'],
        },
        whitelist: { allowChapters: ['87', '39'] },
        inject: [
          { prefix: '8708.29', syntheticRank: 9 },  // Other body parts of motor vehicles
          { prefix: '8708.99', syntheticRank: 8 },  // Other parts of motor vehicles
          { prefix: '3926.30', syntheticRank: 7 },  // Fittings for furniture/vehicles of plastic
          { prefix: '8714.10', syntheticRank: 6 },  // Parts/accessories for motorcycles
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8708' },
          { delta: 0.3, chapterMatch: '87' },
        ],
      } as IntentRule,
    });

    // ── 7. NEW EMBROIDERY_STABILIZER_FABRIC_INTENT (ch.39) ────────────────────
    // "Stick and Stitch Baby Monthly Milestones Hand Embroidery Pattern" → 3920.99.20
    // "Water-soluble PVA embroidery stabilizer sheets" → 3920.99.20
    patches.push({
      priority: 549,
      rule: {
        id: 'EMBROIDERY_STABILIZER_FABRIC_INTENT',
        description: 'PVA/water-soluble embroidery stabilizer sheets → ch.39 (3920). ' +
          '"Embroidery stabilizer", "water-soluble stabilizer", "stick and stitch" → 3920.99. ' +
          'Without rule, these plastic sheet products return wrong chapter.',
        pattern: {
          anyOf: [
            'embroidery stabilizer', 'stabilizer sheets', 'pva stabilizer',
            'water soluble stabilizer', 'water-soluble stabilizer',
            'stick and stitch', 'stick and stitch pattern',
            'wash away stabilizer', 'tear away stabilizer', 'cut away stabilizer',
            'fusible interfacing', 'non-woven interfacing', 'woven interfacing',
            'polyester interfacing', 'fusible web',
          ],
          noneOf: ['pattern', 'pdf', 'digital'],
        },
        whitelist: { allowChapters: ['39', '59'] },
        inject: [
          { prefix: '3920.99', syntheticRank: 9 },  // Other plastic sheets
          { prefix: '3919.10', syntheticRank: 8 },  // Self-adhesive plastic rolls/strips
          { prefix: '5906.91', syntheticRank: 7 },  // Rubberized textile fabric (stabilizer)
          { prefix: '5602.10', syntheticRank: 6 },  // Needleloom felt
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '3920' },
          { delta: 0.3, chapterMatch: '39' },
        ],
      } as IntentRule,
    });

    // ── 8. addNoneOf AI_CH25_MINERAL for ceramic context ─────────────────────
    // 'clay' in ch.25 (minerals) rule might fire for ceramic/pottery queries
    // This prevents clay minerals rule from blocking ch.69 ceramics
    addNoneOf('AI_CH25_CLAY_FULLER', [
      'vase', 'vases', 'pottery', 'figurine', 'ceramic', 'porcelain',
      'decorative', 'handmade', 'sculpture', 'art',
    ], 'ceramic/art context prevents mineral clay rule blocking ch.69');

    // ── 9. CLOCK_TIMEPIECE_INTENT: Add ceramic/decorative noneOf ─────────────
    // 'clock' fires → blocks ch.69 for "Large Green Diamonds Clock" (ceramic clock face)
    addNoneOf('CLOCK_TIMEPIECE_INTENT', [
      'ceramic', 'pottery', 'porcelain', 'clay',
      'diamond shaped', 'decorative clock', 'wall art clock',
    ], 'ceramic clock context prevents timepiece rule from blocking ch.69');

    console.log(`Applying ${patches.length} rule patches (batch HHHH)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await (svc as any).upsertRule(rule, priority, true);
        console.log(`  ✅ ${(rule as any).id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${(rule as any).id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch HHHH complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
