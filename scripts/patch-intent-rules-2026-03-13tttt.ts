#!/usr/bin/env ts-node
/**
 * Patch TTTT — 2026-03-13:
 *
 * Fix top EMPTY result categories from new 5025 entry eval:
 *
 * 1. ch.85: 52 EMPTY cases — automotive electrical switches
 *    "Windshield Wiper Control Switch", "Power Window Switch",
 *    "Automotive Window Switch" → 8536 (electrical switches)
 *    Previously 'switch' was in TIME_SWITCH_TIMER anyOf (ch.91) → wrong ch.91
 *    After RRRR removed 'switch', no positive ch.85 rule for window/wiper switches.
 *    AUTOMOTIVE_IGNITION_ELECTRICAL_INTENT only covers ignition, not power window/wiper.
 *
 * 2. ch.62: 22 EMPTY cases — garments not covered by OUTERWEAR_JACKET_GARMENT_INTENT
 *    "Melton Cloak", "Capelet", "Poncho", "Cargo Pants", "Flannel Shirt",
 *    "Pakistani Suits", "Military Camo Cargo Pants" → ch.62
 *    OUTERWEAR_JACKET_GARMENT_INTENT missing these garment types.
 *
 * 3. ch.69: 20 EMPTY cases — bone china / ceramic dishware
 *    "Bone China Tea Cups", "Blue Floral China Tea Cup", "Vintage Bone China Dishes"
 *    → 6911/6912 (porcelain/china dinnerware)
 *
 * 4. ch.85 permanent magnets: "fridge magnet", "resin fridge magnet" → 8505 (ch.85)
 *    These decorative magnets are permanent magnets → 8505.11 (of metal) or 8505.19 (other)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13tttt.ts
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
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed TTTT: ${note}`,
          pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} anyOf terms`);
    }

    // ── 1. NEW AUTOMOTIVE_ELECTRICAL_SWITCH_INTENT ────────────────────────────
    // "Power Window Switch", "Wiper Control Switch", "Automotive Window Switch"
    // → 8536 (electrical switches for voltage ≤ 1000V) or 8537 (control panels)
    // After RRRR removed 'switch' from TIME_SWITCH_TIMER, no ch.85 rule fires.
    patches.push({
      priority: 585,
      rule: {
        id: 'AUTOMOTIVE_ELECTRICAL_SWITCH_INTENT',
        description: 'Automotive electrical switches and control units → 8536/8537 (ch.85). ' +
          '"Power window switch", "wiper control switch", "window regulator switch", ' +
          '"turn signal switch", "headlight switch", "ignition control". ' +
          'After removing \'switch\' from AI_CH91_TIME_SWITCH_TIMER anyOf, ' +
          'these automotive switches had no positive rule → EMPTY.',
        pattern: {
          anyOf: [
            // Window switches
            'power window switch', 'window switch', 'window control switch',
            'window regulator switch', 'window motor switch',
            // Wiper switches
            'wiper switch', 'wiper control switch', 'windshield wiper switch',
            'wiper stalk', 'wiper control module',
            // Turn signal / multifunction
            'turn signal switch', 'combination switch', 'multifunction switch',
            'column switch', 'steering column switch',
            // Door / interior switches
            'door switch', 'power door switch', 'dome light switch',
            'interior light switch', 'courtesy switch',
            // Headlight / dash
            'headlight switch', 'headlamp switch', 'dash switch',
            'dashboard switch', 'instrument switch',
            // Brake / clutch
            'brake light switch', 'brake switch', 'brake pedal switch',
            'clutch switch', 'neutral safety switch',
            // Miscellaneous
            'automotive switch', 'car switch', 'vehicle switch',
            'rocker switch', 'toggle switch',
          ],
          noneOf: [
            // Keep out light switches (home electrical, ch.85 but different context)
            'wall switch', 'light switch', 'dimmer switch',
            // Keep out time switches (ch.91)
            'time switch', 'timer switch', 'outlet timer',
            // Keep out reed/tactile for electronics
            'reed switch', 'tactile switch',
          ],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8536.50.90', syntheticRank: 9 }, // Other switches, voltage ≤ 1000V
          { prefix: '8536.50.40', syntheticRank: 8 }, // Switches for voltage ≤ 1000V
          { prefix: '8537.10.90', syntheticRank: 7 }, // Boards/panels for voltage ≤ 1000V
          { prefix: '8536.10.00', syntheticRank: 6 }, // Fuses
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '8536' },
          { delta: 0.3, prefixMatch: '8537' },
        ],
      } as IntentRule,
    });

    // ── 2. Expand OUTERWEAR_JACKET_GARMENT_INTENT with more garment types ─────
    // "Melton Cloak", "Capelet", "Poncho", "Cargo Pants", "Flannel Shirt" etc.
    addToAnyOf('OUTERWEAR_JACKET_GARMENT_INTENT', [
      // Cloaks and capes
      'cloak', 'cloaks', 'cape', 'capes', 'capelet', 'capelets',
      'poncho', 'ponchos',
      // Pants / trousers
      'cargo pants', 'cargo trousers', 'camo pants', 'military pants',
      'joggers', 'jogger pants', 'sweatpants', 'track pants',
      // Shirts / tops
      'flannel shirt', 'flannel shirts', 'plaid shirt',
      'tunic', 'tunics', 'blouse', 'blouses',
      // Suits / sets
      'suit set', 'salwar suit', 'kurta', 'kurti', 'salwar kameez',
      'pakistani suit', 'indian suit',
      // Other outerwear
      'poncho', 'wrap', 'shawl wrap',
      'vest', 'gilet',
    ], 'cloak/cape/cargo pants/flannel shirt/tunic/poncho/suit set → ch.61/62');

    // ── 3. NEW BONE_CHINA_CERAMIC_DISHWARE_INTENT ────────────────────────────
    // "Bone China Tea Cups", "Blue Floral China Tea Cup", "Vintage Bone China Dishes"
    // → 6911 (porcelain/china houshold items) or 6912 (ceramic household items)
    // These specific ceramic dishware queries return EMPTY.
    patches.push({
      priority: 562,
      rule: {
        id: 'BONE_CHINA_CERAMIC_DISHWARE_INTENT',
        description: 'Bone china and ceramic dishware → 6911/6912 (ch.69). ' +
          '"Bone china tea cups", "china plates", "vintage bone china", ' +
          '"ceramic serving dishes", "porcelain dinnerware". ' +
          'Generic "china" or "ceramic" queries return EMPTY without chapter restriction.',
        pattern: {
          anyOf: [
            'bone china', 'bone china tea', 'bone china cup', 'bone china plate',
            'bone china dishes', 'bone china mug', 'bone china bowl',
            'fine china', 'china tea cup', 'china tea set', 'china dinnerware',
            'porcelain dinnerware', 'porcelain tea set', 'porcelain plates',
            'porcelain cups', 'porcelain bowl', 'porcelain mug',
            'ceramic dinnerware', 'ceramic dishes', 'ceramic tea set',
            'vintage china', 'vintage china cup', 'vintage bone china',
            'mismatched china', 'milk glass mug', 'vintage anchor hocking',
          ],
          noneOf: [
            // Exclude non-dishware ceramic
            'tile', 'tiles', 'toilet', 'sink', 'tub',
            'planter', 'pot', 'vase', 'figurine',
            'insulator', 'electrical',
            // Exclude china (country) context
            'made in china', 'china post',
          ],
        },
        whitelist: { allowChapters: ['69'] },
        inject: [
          { prefix: '6911.10.58', syntheticRank: 9 }, // Porcelain mugs
          { prefix: '6911.10.38', syntheticRank: 8 }, // Porcelain cups and saucers
          { prefix: '6911.10.41', syntheticRank: 7 }, // Porcelain plates
          { prefix: '6912.00.45', syntheticRank: 6 }, // Other ceramic cups/mugs
          { prefix: '6912.00.48', syntheticRank: 5 }, // Other ceramic plates
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '6911' },
          { delta: 0.35, prefixMatch: '6912' },
        ],
      } as IntentRule,
    });

    // ── 4. NEW PERMANENT_MAGNET_DECORATIVE_INTENT ────────────────────────────
    // "fridge magnet", "resin fridge magnet", "decorative magnet" → 8505 (ch.85)
    // 8505.11 = permanent magnets of metal; 8505.19 = other permanent magnets
    patches.push({
      priority: 558,
      rule: {
        id: 'PERMANENT_MAGNET_DECORATIVE_INTENT',
        description: 'Decorative and craft permanent magnets → 8505 (ch.85). ' +
          '"Fridge magnet", "resin fridge magnet", "refrigerator magnet" → 8505. ' +
          'Without chapter restriction, semantic search finds no match → EMPTY.',
        pattern: {
          anyOf: [
            'fridge magnet', 'fridge magnets', 'refrigerator magnet', 'refrigerator magnets',
            'magnet fridge', 'decorative magnet', 'souvenir magnet',
            'photo magnet', 'resin magnet', 'wooden magnet',
            'magnetic name badge', 'magnetic badge',
            'magnet set', 'magnet kit',
          ],
          noneOf: [
            'magnetic therapy', 'magnetic bracelet',
            'electromagnet', 'magnetic drill',
            'magnetic tool', 'magnetic base',
          ],
        },
        whitelist: { allowChapters: ['85', '96'] },
        inject: [
          { prefix: '8505.19.90', syntheticRank: 9 }, // Other permanent magnets
          { prefix: '8505.11.00', syntheticRank: 8 }, // Permanent magnets of metal
          { prefix: '9601.90.00', syntheticRank: 7 }, // Worked ivory, shells (craft items)
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '8505' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch TTTT)...`);
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
    console.log(`\nPatch TTTT complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
