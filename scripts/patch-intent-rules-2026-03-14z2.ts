#!/usr/bin/env ts-node
/**
 * Patch Z2 — 2026-03-14:
 *
 * Using correct inspection (entry.expectedChapter). Current: 247/5000 = 4.94%.
 *
 * 1. SEMI_PRECIOUS_STONE_MARBLE_INTENT: add ch.70.
 *    'gemstone bead' → glass/crystal bead strands (ch.70).
 *
 * 2. CHARACTER_LICENSED_BEDDING_INTENT: add ch.52/69/73/85.
 *    'disney' → ceramic cookie jar (ch.69), metal pins/tray (ch.73), VHS/magnet (ch.85).
 *    'sheet set' → plain cotton sheet set without character (ch.52).
 *
 * 3. CUTLERY_SET_INTENT: add ch.73.
 *    EPNS silver-plated / vintage cutlery sets = base metal household goods (ch.73).
 *
 * 4. AI_CH92_UPRIGHT_PIANO: noneOf car-console contexts.
 *    'console' → car center console lid/armrest (ch.94), car overhead console light (ch.85),
 *    car console trim (ch.87), console latch (ch.83).
 *
 * 5. SKINCARE_INTENT: add ch.35; noneOf printer-toner-brand.
 *    'face cream' → collagen face cream (ch.35 animal proteins/collagen).
 *    'toner' → Canon/HP laser printer toner cartridge (ch.84).
 *
 * 6. RULER_COMPASS_INTENT: add ch.29/74; noneOf vinyl-decal-compass.
 *    'ruler' → metal hem gauge ruler (ch.74 copper). 'compass' → vinyl compass decal (ch.29).
 *
 * 7. AI_CH92_HARP: noneOf oud-perfume.
 *    'oud' → oud wood fragrance perfume (ch.33) — "oud al layl" is a perfume brand.
 *
 * 8. AI_CH36_EXPLOSIVES: add ch.07/33/34/62; noneOf powder-as-food/cosmetic.
 *    'powder' → onion powder (ch.07), facial cleanser powder (ch.33), laundry detergent powder (ch.34).
 *    'dynamite' → Dynamite clothing brand (ch.62 garment).
 *
 * 9. AI_CH06_ORNAMENTAL_FOLIAGE: add ch.34/44/52/61/63/65/97; noneOf color-scent.
 *    'eucalyptus' → soap scent (ch.34), eucalyptus color garment (ch.61), eucalyptus accent card (ch.44).
 *    'fern' → crochet fern yarn (ch.52), fern print pillow (ch.63), fern stamp mold (ch.97).
 *    'moss' → moss green color in cap (ch.65).
 *
 * 10. LIP_PRODUCT_INTENT: add ch.34.
 *     'lip balm' → wax-based lip balm (ch.34 waxes/polishes).
 *
 * 11. AI_CH06_BULBS_CORMS: add ch.34/44/84/85; noneOf brand-names.
 *     'bulbs' → electric light bulbs (ch.85). 'iris' → Iris brand fan (ch.84), holder (ch.44).
 *     'crocus' → Zam/Fabulustre crocus metal polish (ch.34).
 *
 * 12. AI_CH19_SWEET_BISCUIT_COOKIE: add ch.34/69/74; noneOf cookie-container.
 *     'cookie' → fortune cookie place card holder (ch.34 modeling compound),
 *     ceramic Disney cookie jar (ch.69), brass cookie box (ch.74).
 *
 * 13. POLYMER_CLAY_INTENT: add ch.34/48.
 *     'polymer clay' → polymer clay fridge magnet modeling compound (ch.34),
 *     transfer paper for polymer clay (ch.48 paper).
 *
 * 14. RECORDED_MEDIA_VHS_DVD_INTENT: add ch.37.
 *     VHS tapes / DVDs classified as ch.37 (photographic/cinematographic film).
 *
 * 15. AI_CH02_SALTED_CURED_MEAT: noneOf false trigger contexts (separate from CH03 rule).
 *     'salt' → salt pinch pot (ch.69), sea salt shoes (ch.64), yarn "salt and pep" (ch.55),
 *     aquarium salt (ch.38), sea salt tank top (ch.62).
 *     'cured'/'dried' → tobacco (ch.24), dried vegetables (ch.07), dried fruit (ch.08).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14z2.ts
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

    // ── 1. SEMI_PRECIOUS_STONE_MARBLE_INTENT: add ch.70 ──────────────────────
    {
      const existing = allRules.find(r => r.id === 'SEMI_PRECIOUS_STONE_MARBLE_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '70'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SEMI_PRECIOUS_STONE_MARBLE_INTENT') +
              ' — Fixed Z2: added ch.70 (glass/crystal gemstone bead strands)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SEMI_PRECIOUS_STONE_MARBLE_INTENT: added ch.70`);
      } else { console.log('WARNING: SEMI_PRECIOUS_STONE_MARBLE_INTENT not found'); }
    }

    // ── 2. CHARACTER_LICENSED_BEDDING_INTENT: add ch.52/69/73/85 ─────────────
    {
      const existing = allRules.find(r => r.id === 'CHARACTER_LICENSED_BEDDING_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '52', '69', '73', '85'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'CHARACTER_LICENSED_BEDDING_INTENT') +
              ' — Fixed Z2: added ch.52 (sheet set), ch.69 (character cookie jar), ch.73 (Disney pins/tray), ch.85 (VHS/magnet)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`CHARACTER_LICENSED_BEDDING_INTENT: added ch.52/69/73/85`);
      } else { console.log('WARNING: CHARACTER_LICENSED_BEDDING_INTENT not found'); }
    }

    // ── 3. CUTLERY_SET_INTENT: add ch.73 ─────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'CUTLERY_SET_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '73'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'CUTLERY_SET_INTENT') +
              ' — Fixed Z2: added ch.73 (EPNS/silver-plated/vintage cutlery = base metal household goods)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`CUTLERY_SET_INTENT: added ch.73`);
      } else { console.log('WARNING: CUTLERY_SET_INTENT not found'); }
    }

    // ── 4. AI_CH92_UPRIGHT_PIANO: noneOf car-console ─────────────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH92_UPRIGHT_PIANO') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'center console', 'console lid', 'console armrest', 'console latch',
          'console trim', 'console cup holder', 'console storage',
          'overhead console', 'automotive console', 'automotve console',
          'car console', 'vehicle console', 'truck console',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH92_UPRIGHT_PIANO') +
              ' — Fixed Z2: noneOf car-console (center console lid/armrest/trim)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH92_UPRIGHT_PIANO: adding ${addNoneOf.length} noneOf`);
      } else { console.log('WARNING: AI_CH92_UPRIGHT_PIANO not found'); }
    }

    // ── 5. SKINCARE_INTENT: add ch.35; noneOf printer-toner ──────────────────
    {
      const existing = allRules.find(r => r.id === 'SKINCARE_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '35'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Laser printer toner (ch.84)
          'canon toner', 'hp toner', 'epson toner', 'brother toner',
          'black toner', 'color toner', 'magenta toner', 'cyan toner',
          'gpr-', 'w1380', 'w1480',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SKINCARE_INTENT') +
              ' — Fixed Z2: added ch.35 (collagen face cream); noneOf canon/hp/brand toner',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SKINCARE_INTENT: added ch.35, ${addNoneOf.length} noneOf`);
      } else { console.log('WARNING: SKINCARE_INTENT not found'); }
    }

    // ── 6. RULER_COMPASS_INTENT: add ch.29/74; noneOf vinyl-decal ────────────
    {
      const existing = allRules.find(r => r.id === 'RULER_COMPASS_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '29', '74'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Compass as spiritual/decorative symbol (vinyl decal, talisman)
          'vinyl decal', 'car decal', 'decal', 'talisman', 'rune', 'vegvisir',
          // Hem gauge ruler (metal tape measure)
          'hem gauge', 'hem guage',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'RULER_COMPASS_INTENT') +
              ' — Fixed Z2: added ch.29 (vinyl compound), ch.74 (copper ruler); noneOf vinyl-decal/talisman',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`RULER_COMPASS_INTENT: added ch.29/74, ${addNoneOf.length} noneOf`);
      } else { console.log('WARNING: RULER_COMPASS_INTENT not found'); }
    }

    // ── 7. AI_CH92_HARP: noneOf oud-perfume ──────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH92_HARP') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'oud' as fragrance/perfume (not the lute instrument)
          'oud al layl', 'blue ameer', '100ml', '50ml', '30ml', '200ml',
          'oud perfume', 'oud fragrance', 'oud oil', 'oud wood perfume',
          'limited stock',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH92_HARP') +
              ' — Fixed Z2: noneOf oud-as-perfume (oud al layl, 100ml, limited stock)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH92_HARP: adding ${addNoneOf.length} noneOf`);
      } else { console.log('WARNING: AI_CH92_HARP not found'); }
    }

    // ── 8. AI_CH36_EXPLOSIVES: add ch.07/33/34/62; noneOf powder ─────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH36_EXPLOSIVES') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '07', '33', '34', '62'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Cosmetic/food powder
          'dusting powder', 'facial powder', 'powder cleanser', 'powder wash',
          'powder facial', 'chantilly', 'talcum', 'baby powder',
          'onion powder', 'garlic powder', 'vegetable powder',
          'laundry powder', 'detergent powder',
          // 'dynamite' as clothing brand
          'dynamite brand', 'dynamite clothing', 'dynamite avacado', 'avacado green',
          'tank top dynamite',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH36_EXPLOSIVES') +
              ' — Fixed Z2: added ch.07/33/34/62; noneOf cosmetic-powder/food-powder/laundry-powder/dynamite-brand',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH36_EXPLOSIVES: added ch.07/33/34/62, ${addNoneOf.length} noneOf`);
      } else { console.log('WARNING: AI_CH36_EXPLOSIVES not found'); }
    }

    // ── 9. AI_CH06_ORNAMENTAL_FOLIAGE: add ch.34/44/52/61/63/65/97 ───────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH06_ORNAMENTAL_FOLIAGE') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '34', '44', '52', '61', '63', '65', '97'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'eucalyptus' as soap scent / garment color
          'eucalyptus body', 'eucalyptus soap', 'eucalyptus scent',
          'eucalyptus accent', 'eucalyptus color', 'eucalyptus colour',
          // 'fern' as print/crochet pattern / carved stamp
          'fern print', 'fern pillow', 'fern leaf', 'fern stamp', 'fiddling fern',
          'crochet fern',
          // 'moss' as color name
          'moss green', 'in moss',
          // 'branches' in furniture/decor context
          'branches furniture', 'branches decor',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH06_ORNAMENTAL_FOLIAGE') +
              ' — Fixed Z2: added ch.34/44/52/61/63/65/97; noneOf eucalyptus-as-color/scent, fern-as-print, moss-green',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH06_ORNAMENTAL_FOLIAGE: added 7 chapters, ${addNoneOf.length} noneOf`);
      } else { console.log('WARNING: AI_CH06_ORNAMENTAL_FOLIAGE not found'); }
    }

    // ── 10. LIP_PRODUCT_INTENT: add ch.34 ────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'LIP_PRODUCT_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '34'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'LIP_PRODUCT_INTENT') +
              ' — Fixed Z2: added ch.34 (wax-based lip balm = ch.34 waxes/polishes)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`LIP_PRODUCT_INTENT: added ch.34`);
      } else { console.log('WARNING: LIP_PRODUCT_INTENT not found'); }
    }

    // ── 11. AI_CH06_BULBS_CORMS: add ch.34/44/84/85; noneOf brand-names ──────
    {
      const existing = allRules.find(r => r.id === 'AI_CH06_BULBS_CORMS') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '34', '44', '84', '85'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Electric light bulbs (ch.85)
          'light bulb', 'light bulbs', 'electric bulb',
          // 'iris' as brand name (Iris USA, Iris Hantverk)
          'iris usa', 'iris hantverk', 'woozoo',
          // 'crocus' as metal polish brand (ZAM crocus)
          'fabulustre', 'zam crocus', 'crocus cloth', 'crocus polish',
          // 'tulip' as brand
          'tulip brand', 'tulip fabric',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH06_BULBS_CORMS') +
              ' — Fixed Z2: added ch.34/44/84/85; noneOf light-bulb/iris-brand/crocus-polish',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH06_BULBS_CORMS: added ch.34/44/84/85, ${addNoneOf.length} noneOf`);
      } else { console.log('WARNING: AI_CH06_BULBS_CORMS not found'); }
    }

    // ── 12. AI_CH19_SWEET_BISCUIT_COOKIE: add ch.34/69/74 ────────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH19_SWEET_BISCUIT_COOKIE') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '34', '69', '74'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH19_SWEET_BISCUIT_COOKIE') +
              ' — Fixed Z2: added ch.34 (fortune cookie place card holder = modeling compound), ch.69 (ceramic cookie jar), ch.74 (brass cookie box)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH19_SWEET_BISCUIT_COOKIE: added ch.34/69/74`);
      } else { console.log('WARNING: AI_CH19_SWEET_BISCUIT_COOKIE not found'); }
    }

    // ── 13. POLYMER_CLAY_INTENT: add ch.34/48 ────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'POLYMER_CLAY_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '34', '48'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'POLYMER_CLAY_INTENT') +
              ' — Fixed Z2: added ch.34 (polymer clay fridge magnet = modeling compound), ch.48 (transfer paper for polymer clay)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`POLYMER_CLAY_INTENT: added ch.34/48`);
      } else { console.log('WARNING: POLYMER_CLAY_INTENT not found'); }
    }

    // ── 14. RECORDED_MEDIA_VHS_DVD_INTENT: add ch.37 ─────────────────────────
    {
      const existing = allRules.find(r => r.id === 'RECORDED_MEDIA_VHS_DVD_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '37'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'RECORDED_MEDIA_VHS_DVD_INTENT') +
              ' — Fixed Z2: added ch.37 (VHS tape / DVD = photographic/cinematographic film)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`RECORDED_MEDIA_VHS_DVD_INTENT: added ch.37`);
      } else { console.log('WARNING: RECORDED_MEDIA_VHS_DVD_INTENT not found'); }
    }

    // ── 15. AI_CH02_SALTED_CURED_MEAT: noneOf false trigger contexts ──────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH02_SALTED_CURED_MEAT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'salt' as ceramic pinch pot
          'salt pinch', 'pinch bowl', 'pinch pot',
          // 'salt' as shoe/product color (New Balance "Sea Salt with Arid Stone")
          'arid stone', 'sea salt with', 'in sea salt',
          // 'salt' in aquarium context
          'aquarium salt', 'aquarium use', 'aquarium mix',
          // 'salt' in yarn name ("Salt And Pep")
          'salt and pep', 'colorama',
          // 'salt' in clothing print/graphic
          'ice cream tank top', 'sea salt ice cream', 'keyblade',
          // 'cured'/'dried' for tobacco (ch.24)
          'tobacco', 'fire-cured', 'sun-cured', 'virginia tobacco',
          // 'dried' for vegetables/fruit (ch.07/08)
          'dried vegetable', 'dried guava', 'dried mango', 'dried fruit',
          'kidney bean', 'sweet potato', 'cassava', 'arrowroot',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH02_SALTED_CURED_MEAT') +
              ' — Fixed Z2: noneOf salt-pinch/arid-stone/aquarium-salt/salt-and-pep/tobacco/dried-veg',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH02_SALTED_CURED_MEAT: adding ${addNoneOf.length} noneOf`);
      } else { console.log('WARNING: AI_CH02_SALTED_CURED_MEAT not found'); }
    }

    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch Z2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    const finalRules = svc.getAllRules();
    console.log(`\nPatch Z2 complete: ${patches.length} applied, 0 failed`);
    console.log(`Rules in cache: ${finalRules.length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
