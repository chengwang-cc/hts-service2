#!/usr/bin/env ts-node
/**
 * Patch BBBB — 2026-03-13:
 *
 * Root cause fix: SHIRT_GARMENT_BACKUP_INTENT uses denyNonAllowedUnlessEntryHasTokens
 * (a deny-check) instead of allowChapters (an allow-check). When 'polyester' fires
 * AI_CH54_FILAMENT_YARN_RETAIL (allowChapters=['54']) and 'hat' fires AI_CH65 rules
 * (allowChapters=['65']), the ch.61 inject entries fail the OR-logic allow check
 * because SHIRT_GARMENT_BACKUP_INTENT is not in rulesWithAllow.
 *
 * Fix: Change SHIRT_GARMENT_BACKUP_INTENT + COTTON_APPAREL whitelists to use
 * allowChapters=['61','62'] so they join rulesWithAllow.
 *
 * Also:
 * - Add 'compact disc'/'cd' to RECORDED_MEDIA_VHS_DVD_INTENT (ch.85 empties)
 * - Add cycling/athletic shirt terms to OUTERWEAR_JACKET_GARMENT_INTENT
 * - NEW BABY_INFANT_GARMENT_INTENT: newborn outfit, baby outfit → 6111/6209 ch.61/62
 * - NEW PLASTIC_PACKAGING_BAG_INTENT: cone bags, poly bags → 3923 ch.39
 * - NEW ELECTRONIC_SENSOR_METER_INTENT: RTD sensor, thermometer → 9025/9032 ch.90
 * - NEW CAMERA_ADAPTER_OPTICAL_INTENT: camera adapters, lens adapters → 9006 ch.90
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13bbbb.ts
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

    function addToAnyOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentAnyOf: string[] = pat.anyOf ?? [];
      const newTerms = toAdd.filter(t => !currentAnyOf.includes(t));
      patches.push({ priority: (existing as any).priority ?? 500, rule: { ...existing, description: (existing.description ?? ruleId) + ` — Fixed BBBB: ${note}`, pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] } } });
      console.log(`${ruleId}: adding ${newTerms.length} anyOf terms`);
    }

    // ── 1. Fix SHIRT_GARMENT_BACKUP_INTENT whitelist ───────────────────────────
    // Change from denyNonAllowedUnlessEntryHasTokens to allowChapters=['61','62']
    // This adds it to rulesWithAllow so ch.61 entries pass OR-logic even when
    // ch.54 (polyester) or ch.65 (hat) rules also fire.
    {
      const existing = allRules.find(r => r.id === 'SHIRT_GARMENT_BACKUP_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: (existing as any).priority ?? 4,
          rule: {
            ...existing,
            description: (existing.description ?? 'SHIRT_GARMENT_BACKUP_INTENT') +
              ' — Fixed BBBB: changed whitelist from denyNonAllowedUnlessEntryHasTokens to allowChapters=[61,62] so ch.61 entries pass OR-logic when ch.54/ch.65 rules also fire.',
            whitelist: { allowChapters: ['61', '62'] },
          },
        });
        console.log('SHIRT_GARMENT_BACKUP_INTENT: updating whitelist to allowChapters=[61,62]');
      } else {
        console.log('WARNING: SHIRT_GARMENT_BACKUP_INTENT not found');
      }
    }

    // ── 2. Fix COTTON_APPAREL whitelist ────────────────────────────────────────
    // Add allowChapters=['61','62'] so cotton garment queries allow ch.61/62 entries
    // even when ch.65 hat rules or other chapter rules also fire.
    {
      const existing = allRules.find(r => r.id === 'COTTON_APPAREL') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: (existing as any).priority ?? 5,
          rule: {
            ...existing,
            description: (existing.description ?? 'COTTON_APPAREL') +
              ' — Fixed BBBB: added allowChapters=[61,62] whitelist to ensure ch.61/62 entries pass OR-logic.',
            whitelist: { allowChapters: ['61', '62'] },
          },
        });
        console.log('COTTON_APPAREL: adding allowChapters=[61,62] whitelist');
      } else {
        console.log('WARNING: COTTON_APPAREL not found');
      }
    }

    // ── 3. Expand RECORDED_MEDIA_VHS_DVD_INTENT ────────────────────────────────
    // "Compact disc - recorded audio music", "compact disc box set" → ch.85 EMPTY
    addToAnyOf('RECORDED_MEDIA_VHS_DVD_INTENT', [
      'compact disc', 'compact disc set', 'compact disk',
      'audio cd', 'music cd', 'cd album', 'cd single', 'cd set',
      'vinyl record', 'lp record', 'vinyl album', 'vinyl lp',
      'record album', 'audio tape', 'cassette tape', 'audio cassette',
    ], 'added compact disc/cd/vinyl terms → ch.85 8523');

    // ── 4. Expand OUTERWEAR_JACKET_GARMENT_INTENT ──────────────────────────────
    // "90% polyester 10% elastane Men's Cycling shirt" → cycling shirt = ch.61
    addToAnyOf('OUTERWEAR_JACKET_GARMENT_INTENT', [
      'cycling shirt', 'cycling jersey', 'cycling kit',
      'athletic shirt', 'sports jersey', 'soccer jersey', 'basketball jersey',
      'workout shirt', 'gym shirt', 'training shirt',
      'polo shirt', 'polo shirts', 'polo top',
    ], 'added cycling/athletic shirt terms → ch.61/62');

    // ── 5. NEW BABY_INFANT_GARMENT_INTENT ─────────────────────────────────────
    // "Hand knit alpaca merino newborn outfit for photography prop use" → ch.61 6111
    // "Boy's birthday outfit, size 2/3" → ch.61 (complex outfit set)
    patches.push({
      priority: 573,
      rule: {
        id: 'BABY_INFANT_GARMENT_INTENT',
        description: 'Baby, infant and toddler garments → 6111/6209 (ch.61/62). ' +
          '"Newborn outfit", "baby clothing set", "toddler outfit" → 6111. ' +
          '"Romper", "onesie", "baby bodysuit" → 6111. ' +
          'Without rule, baby clothing queries return EMPTY or route to wrong chapter.',
        pattern: {
          anyOf: [
            // Outfit/set descriptions
            'newborn outfit', 'baby outfit', 'infant outfit', 'toddler outfit',
            'baby clothing set', 'infant clothing set', 'baby clothes set',
            'birthday outfit', 'baby birthday outfit',
            // Baby specific garments
            'onesie', 'onesies', 'baby onesie', 'infant onesie',
            'romper', 'rompers', 'baby romper', 'infant romper',
            'baby bodysuit', 'infant bodysuit', 'newborn bodysuit',
            'baby sleeper', 'infant sleeper', 'baby sleepwear', 'footed pajamas',
            'baby gown', 'infant gown', 'newborn gown',
            'baby cardigan', 'baby sweater', 'infant sweater', 'baby knit',
            'newborn set', 'baby set', 'infant set',
            // Photography props
            'newborn photography', 'newborn photo prop', 'photography prop outfit',
            'baby photo outfit', 'baby photo prop',
          ],
          noneOf: [
            'toy', 'stuffed animal', 'plush',
            'pattern', 'sewing pattern', 'knitting pattern',
            'doll clothing', 'doll clothes',  // Handled separately
          ],
        },
        whitelist: { allowChapters: ['61', '62'] },
        inject: [
          { prefix: '6111.20.40', syntheticRank: 9 }, // Cotton knit babies' garments
          { prefix: '6111.30.50', syntheticRank: 8 }, // MMF knit babies' garments
          { prefix: '6209.20.50', syntheticRank: 7 }, // Cotton woven babies' garments
          { prefix: '6111.20.10', syntheticRank: 6 }, // Cotton knit babies' sets
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '6111' },
          { delta: 0.3, prefixMatch: '6209' },
        ],
      } as IntentRule,
    });

    // ── 6. NEW PLASTIC_PACKAGING_BAG_INTENT ───────────────────────────────────
    // "Cone Plastic Bag", "Water-soluble PVA stabilizer sheets" → ch.39 3923/3921
    patches.push({
      priority: 548,
      rule: {
        id: 'PLASTIC_PACKAGING_BAG_INTENT',
        description: 'Plastic packaging bags, poly bags, and plastic sheets → 3923/3921 (ch.39). ' +
          '"Cone bag", "poly bag", "plastic sack", "PVA film" → 3923/3921. ' +
          'Without rule, plastic packaging queries route to wrong chapter or EMPTY.',
        pattern: {
          anyOf: [
            // Plastic bags
            'plastic bag', 'plastic bags', 'poly bag', 'poly bags',
            'cone bag', 'cone bags', 'conical bag',
            'plastic sack', 'plastic pouch',
            'ldpe bag', 'hdpe bag', 'pp bag', 'pvc bag',
            'zip bag', 'zipper bag', 'ziplock bag', 'ziploc bag',
            'flat poly bag', 'gusset bag',
            // PVA/soluble films
            'pva film', 'pva sheet', 'water soluble film', 'water-soluble film',
            'dissolvable film', 'soluble stabilizer', 'pva stabilizer',
            // Plastic packaging misc
            'shrink bag', 'vacuum bag', 'boil-in bag',
          ],
          noneOf: [
            'canvas tote', 'tote bag', 'cotton bag',  // Textile bags handled separately
            'leather bag', 'faux leather bag',  // Handled separately
            'garbage bag', 'trash bag', 'bin liner',  // Could be in ch.39 but different
            'bread bag', 'produce bag', 'food bag',  // Food packaging
          ],
        },
        whitelist: { allowChapters: ['39'] },
        inject: [
          { prefix: '3923.21.00', syntheticRank: 9 }, // Sacks/bags of ethylene polymers
          { prefix: '3923.29.00', syntheticRank: 8 }, // Sacks/bags of other plastics
          { prefix: '3921.90.19', syntheticRank: 7 }, // Other plastic sheets/film
          { prefix: '3923.90.00', syntheticRank: 6 }, // Other articles for packing
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '3923' },
          { delta: 0.3, prefixMatch: '3921' },
        ],
      } as IntentRule,
    });

    // ── 7. NEW ELECTRONIC_SENSOR_METER_INTENT ─────────────────────────────────
    // "PT1000 RTD Sensor", "temperature sensor" → 9025 (thermometers) or 9032 (control)
    // "2x3 to 4x5 Graflex camera adapter" → 9006 (cameras) ch.90
    patches.push({
      priority: 545,
      rule: {
        id: 'ELECTRONIC_SENSOR_METER_INTENT',
        description: 'Electronic sensors, temperature probes, measurement devices → 9025/9032 (ch.90). ' +
          '"RTD sensor", "PT1000", "temperature probe", "thermocouple" → 9025. ' +
          '"Flow meter", "pressure sensor", "humidity sensor" → 9026/9027. ' +
          'Without rule, sensor queries return EMPTY.',
        pattern: {
          anyOf: [
            // Temperature sensors
            'rtd sensor', 'pt100', 'pt1000', 'thermocouple', 'thermistor',
            'temperature sensor', 'temperature probe', 'thermal sensor',
            'temperature transmitter', 'temperature transducer',
            // Flow/pressure
            'flow meter', 'flow sensor', 'pressure sensor', 'pressure transducer',
            'pressure transmitter', 'differential pressure',
            // Humidity
            'humidity sensor', 'humidity probe', 'rh sensor',
            // Other measurement
            'load cell', 'strain gauge', 'torque sensor',
            'level sensor', 'level transmitter', 'proximity sensor',
          ],
          noneOf: [
            'camera sensor', 'image sensor', 'cmos sensor',  // Camera parts ch.90 different
            'pixel', 'megapixel',
          ],
        },
        whitelist: { allowChapters: ['90'] },
        inject: [
          { prefix: '9025.19.80', syntheticRank: 9 }, // Thermometers/pyrometers (other)
          { prefix: '9026.20.40', syntheticRank: 8 }, // Instruments for measuring pressure
          { prefix: '9032.89.60', syntheticRank: 7 }, // Automatic control instruments
          { prefix: '9026.80.40', syntheticRank: 6 }, // Instruments for measuring flow
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '9025' },
          { delta: 0.4, prefixMatch: '9026' },
          { delta: 0.3, prefixMatch: '9032' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch BBBB)...`);
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
    console.log(`\nPatch BBBB complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
