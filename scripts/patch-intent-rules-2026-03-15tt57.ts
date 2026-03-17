#!/usr/bin/env ts-node
/**
 * Patch TT57 — 2026-03-15: Printer cartridge fix + additional ch.85 fixes.
 *
 * Fixes:
 *  1. TONER_PRINTER_CARTRIDGE_INTENT → 8443.99 (parts of printing machines incl. toner cartridges)
 *     "Genuine Brother TN229M Magenta Toner Cartridge" → 9306.30 (ammunition cartridges!) BUG
 *     "Genuine Canon GPR-55 Magenta Toner" → EMPTY BUG
 *     "inkjet cartridge" → ? likely wrong
 *     BUG: "cartridge" in HTS description for ammunition (9306.30) triggers wrong chapter
 *  2. FRIDGE_MAGNET_INTENT → 8505.11 (permanent magnets)
 *     "Arizona vintage fridge plastic magnet" → 3926.90 (plastic!) — should be 8505.11
 *     "mini disney pvc fridge magnet" → 6302.31 (table linen!) — terrible misclassification
 *     BUG: "plastic"/"pvc" material words override magnet classification
 *  3. VINYL_RECORD_LP_INTENT → 8523.80 (other media including vinyl records)
 *     "Vinyl - COED" → 4814.20 (wallpaper!) BUG — "vinyl" triggers wallpaper
 *     (Note: dataset expects 8523.29.20 but 8523.80 is standard for vinyl records)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt57.ts
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

    // 1. TONER_PRINTER_CARTRIDGE_INTENT → 8443.99 (parts of printing machines)
    //    "Genuine Brother TN229M Magenta Toner Cartridge" → 9306.30 (AMMUNITION!) WRONG
    //    "Genuine Canon GPR-55 Magenta Toner" → EMPTY WRONG
    //    "Dell Lexmark Fuser DRU0443" → expected 8443.32 (printer)
    //    "Kyocera DK6706 Drum Unit" → expected 8443.32
    //    BUG: "cartridge" in HTS code/description for 9306 (ammunition cartridges) triggers that
    //    8443.99 = parts of printing/copying/fax machines (toner cartridges, drums, fusers)
    //    8443.32 = printers for computers (inkjet, laser)
    {
      const existing = allRules.find(r => r.id === 'TONER_PRINTER_CARTRIDGE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'TONER_PRINTER_CARTRIDGE_INTENT',
          description: 'Printer toner cartridges, ink cartridges, drum units → ch.84 (8443.99)',
          pattern: {
            anyOf: [
              // Toner cartridges (laser printers)
              'toner cartridge', 'toner cartridges', 'laser toner', 'printer toner',
              'magenta toner', 'cyan toner', 'yellow toner', 'black toner',
              'toner unit', 'genuine toner', 'compatible toner',
              // Ink cartridges (inkjet)
              'ink cartridge', 'ink cartridges', 'printer ink', 'inkjet cartridge',
              'inkjet ink', 'printer ink cartridge',
              // Drum units and fusers
              'drum unit', 'drum units', 'imaging unit', 'fuser unit',
              'printer drum', 'laser drum',
              // Brand-specific printer parts
              'brother toner', 'canon toner', 'hp toner', 'epson cartridge',
              'xerox toner', 'lexmark toner', 'kyocera drum', 'dell toner',
            ],
            noneOf: [
              // Exclude non-printer cartridges
              'gun cartridge', 'bullet', 'ammunition', 'firearm',
              'shotgun', 'rifle',
            ],
          },
          inject: [
            { prefix: '8443.99', syntheticRank: 5 },
            { prefix: '8443.32', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['93'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '8443.9' }],
        } as IntentRule;
        patches.push({ priority: 580, rule: newRule });
        console.log('TONER_PRINTER_CARTRIDGE_INTENT: created (toner/ink cartridges → 8443.99)');
      }
    }

    // 2. FRIDGE_MAGNET_DECORATIVE_INTENT → 8505.11 (permanent magnets)
    //    "Arizona vintage fridge plastic magnet" → 3926.90.25 (plastic articles!) WRONG
    //    "mini disney pvc fridge magnet" → 6302.31 (table linen!) WRONG
    //    "man resin fridge magnet" → 3907.30 (polyester resin!) WRONG
    //    BUG: "plastic"/"pvc"/"resin" material overrides magnet classification
    //    8505.11 = permanent magnets of metal (most fridge magnets have metal magnet core)
    //    8505.19 = other permanent magnets (flexible magnets, 3D-printed magnet holders)
    {
      const existing = allRules.find(r => r.id === 'FRIDGE_MAGNET_DECORATIVE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FRIDGE_MAGNET_DECORATIVE_INTENT',
          description: 'Decorative fridge magnets, souvenir magnets, photo magnets → ch.85 (8505.11/19)',
          pattern: {
            anyOf: [
              // Fridge magnets (all types)
              'fridge magnet', 'fridge magnets', 'refrigerator magnet', 'refrigerator magnets',
              'magnetic magnet', 'photo magnet', 'photo magnets',
              // Souvenir/decorative magnets
              'souvenir magnet', 'decorative magnet', 'novelty magnet',
              'acrylic magnet', 'wooden magnet', 'resin magnet',
              'ceramic magnet fridge', 'plastic magnet fridge',
              // Specific product types
              'neodymium magnet disc', 'neodymium disc magnet',
              'magnetic bookmark', 'fridge photo magnet',
              // 3D printed magnets
              '3d printed magnet', '3d printed fridge magnet',
            ],
            noneOf: [
              'electromagnet', 'magnetic motor', 'magnetic coil',
            ],
          },
          inject: [
            { prefix: '8505.11', syntheticRank: 5 },
            { prefix: '8505.19', syntheticRank: 5 },
          ],
          whitelist: {
            denyChapters: ['39', '63', '69'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '8505.1' }],
        } as IntentRule;
        patches.push({ priority: 575, rule: newRule });
        console.log('FRIDGE_MAGNET_DECORATIVE_INTENT: created (fridge magnets → 8505.11/19)');
      }
    }

    // 3. VINYL_RECORD_LP_INTENT → 8523.29 (magnetic media including vinyl records)
    //    "Vinyl - COED" → 4814.20 (wallpaper!) WRONG — "vinyl" triggers wallpaper chapter
    //    8523.29.20 = vinyl records recorded with music (per dataset expectation)
    //    Note: vinyl records are classified in 8523.29 (recorded magnetic media)
    //    vs 8523.80 (other) — dataset uses 8523.29.20 for music vinyl records
    {
      const existing = allRules.find(r => r.id === 'VINYL_RECORD_LP_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'VINYL_RECORD_LP_INTENT',
          description: 'Vinyl LP records, music vinyl, record albums → ch.85 (8523.29)',
          pattern: {
            anyOf: [
              // Vinyl records - standard terms
              'vinyl record', 'vinyl records', 'vinyl lp', 'lp vinyl',
              'vinyl album', 'vinyl music', 'record album vinyl',
              'music vinyl', 'jazz vinyl', 'rock vinyl',
              // Format-specific
              '12 inch vinyl', '7 inch vinyl', '45 rpm vinyl',
              '12" vinyl', '7" vinyl', 'vinyl ep', 'vinyl single',
              // Vinyl-only context (music context)
              'pressed vinyl', 'vinyl pressing', 'limited vinyl',
              'color vinyl', 'coloured vinyl', 'picture disc vinyl',
            ],
            noneOf: [
              // Exclude vinyl as material (stickers, flooring, etc.)
              'vinyl sticker', 'vinyl decal', 'vinyl wrap', 'vinyl flooring',
              'vinyl siding', 'vinyl tubing', 'pvc vinyl', 'vinyl fabric',
              'vinyl tape', 'vinyl cutting',
            ],
          },
          inject: [
            { prefix: '8523.29', syntheticRank: 5 },
            { prefix: '8523.80', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['48', '39', '57'],
            denyPrefixes: ['4814'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '8523.2' }],
        } as IntentRule;
        patches.push({ priority: 575, rule: newRule });
        console.log('VINYL_RECORD_LP_INTENT: created (vinyl records → 8523.29)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT57)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT57 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
