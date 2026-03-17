#!/usr/bin/env ts-node
/**
 * Patch QQQQ — 2026-03-13:
 *
 * Fix 4 cross-chapter misfires in new 5025 entry eval:
 *
 * 1. LEATHER_HIDES_INTENT fires on 'leather' → "faux leather capri" → ch.41 (raw hides)
 *    'leather' anyOf fires → denyChapters=['02','03'] only → semantic finds ch.41 leather.
 *    "faux leather" / "vegan leather" / "pu leather" are synthetic materials used in garments.
 *    Fix: add faux/PU/synthetic leather terms to noneOf
 *
 * 2. AI_CH01_LIVE_DOGS_CATS inject fires on 'dog' → "cloth dog toy" → 0106 (live dogs)
 *    syntheticRank=40 inject for 0106.19.91 dominates even for dog toy queries.
 *    Fix: add toy/plush/cloth/stuffed to noneOf so inject doesn't fire for pet toy queries
 *
 * 3. NEW AUTOMOTIVE_SMALL_MOTOR_INTENT
 *    "Car Sunroof Motor" → expected 8501.31.40 (DC motor), got 8703.40 (motor homes)
 *    Specific automotive electrical motors (sunroof, window, wiper, seat) → ch.85
 *    No intent rule catches these → semantic finds "motor" in "motor homes" description
 *
 * 4. AI_CH91_PARKING_METER: remove standalone 'meter'/'meters' from anyOf
 *    'meter' fires this rule → "power meter", "electric meter", "flow meter" → ch.91 (parking meter)
 *    Fix: replace 'meter'/'meters' with specific phrase 'parking meter'/'parking meters'
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13qqqq.ts
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
        priority: 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed QQQQ: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. LEATHER_HIDES_INTENT: exclude faux/synthetic leather ──────────────
    // 'leather' in anyOf fires for "faux leather capri", "pu leather pants", etc.
    // These are synthetic materials for garments (ch.61/62), not raw animal hides (ch.41).
    // Adding 'faux leather' as phrase: if queryLower contains 'faux leather' → noneOf matches.
    addNoneOf('LEATHER_HIDES_INTENT', [
      'faux leather', 'faux', 'vegan leather', 'pu leather', 'pleather',
      'synthetic leather', 'eco leather', 'bonded leather', 'patent leather',
      'capri', 'leggings', 'pants', 'trousers', 'shorts', 'skirt', 'dress',
      'jacket', 'coat', 'vest', 'blazer', 'top', 'shirt',
    ], '"faux leather" / "pu leather" are synthetic garment materials (ch.61/62), not raw hides (ch.41)');

    // ── 2. AI_CH01_LIVE_DOGS_CATS: exclude toy/pet-toy context ───────────────
    // inject syntheticRank=40 for 0106.19.91 (live dogs) fires on any 'dog' query.
    // "cloth dog toy", "plush dog toy", "dog chew toy" → 0106 (live dogs!) instead of ch.95/42.
    addNoneOf('AI_CH01_LIVE_DOGS_CATS', [
      'toy', 'toys', 'plush', 'stuffed', 'squeaky', 'chew', 'chew toy',
      'pet toy', 'dog toy', 'dog toys', 'cat toy', 'cat toys',
      'cloth', 'rope toy', 'tug toy', 'interactive toy', 'puzzle toy',
      'treat', 'treats', 'snack', 'food', 'kibble', 'feed', 'biscuit',
    ], 'toy/plush/cloth context prevents live-dog inject from firing on dog toy queries');

    // ── 3. AI_CH91_PARKING_METER: replace 'meter'/'meters' with phrases ──────
    // 'meter' alone fires → "power meter", "electric meter", "flow meter",
    //   "paint thickness meter" → allowChapters=['91'] (parking meters) → wrong
    // Fix: remove generic 'meter'/'meters', keep specific 'parking meter' phrases.
    {
      const existing = allRules.find(r => r.id === 'AI_CH91_PARKING_METER') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const newAnyOf = currentAnyOf
          .filter(t => t !== 'meter' && t !== 'meters')
          .concat(
            ['parking meter', 'parking meters', 'coin meter', 'coin-operated meter']
              .filter(t => !currentAnyOf.includes(t))
          );
        patches.push({
          priority: 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH91_PARKING_METER') +
              ' — Fixed QQQQ: replaced generic "meter"/"meters" with "parking meter" phrases to avoid ' +
              'misfiring on power meter, flow meter, thickness meter queries.',
            pattern: { ...pat, anyOf: newAnyOf },
          },
        });
        console.log(`AI_CH91_PARKING_METER: replaced 'meter'/'meters' with 'parking meter' phrases`);
      } else {
        console.log('WARNING: AI_CH91_PARKING_METER not found');
      }
    }

    // ── 4. NEW AUTOMOTIVE_SMALL_MOTOR_INTENT ─────────────────────────────────
    // "Car Sunroof Motor" → expected 8501.31.40 (DC motor), got 8703.40 (motor homes)
    // "power window motor", "wiper motor", "seat motor" → all ch.85 DC motors
    // No rule catches these → semantic finds "motor" in "motor homes" description → ch.87.
    patches.push({
      priority: 570,
      rule: {
        id: 'AUTOMOTIVE_SMALL_MOTOR_INTENT',
        description: 'Automotive electric motors (sunroof, power window, wiper, seat) → 8501 (ch.85). ' +
          'Previously routed to ch.87 (motor vehicles) because "motor" semantically matched ' +
          '"motor homes" (8703) without chapter restriction.',
        pattern: {
          anyOf: [
            'sunroof motor', 'sunroof actuator',
            'power window motor', 'window regulator motor', 'window lift motor',
            'wiper motor', 'windshield wiper motor', 'windscreen wiper motor',
            'seat motor', 'power seat motor', 'electric seat motor',
            'door mirror motor', 'side mirror motor', 'wing mirror motor',
            'trunk motor', 'tailgate motor', 'liftgate motor',
            'fuel pump motor', 'washer pump motor', 'radiator fan motor',
            'blower motor', 'hvac blower motor', 'heater blower motor',
          ],
          noneOf: ['bicycle', 'bike', 'motorcycle', 'scooter'],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8501.31.40', syntheticRank: 9 }, // DC motors, 37.5W < output ≤ 750W
          { prefix: '8501.20.40', syntheticRank: 8 }, // Universal motors, > 37.5W
          { prefix: '8501.10.40', syntheticRank: 7 }, // Motors, output ≤ 37.5W
          { prefix: '8501.10.20', syntheticRank: 6 }, // Brushless DC motors
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '8501' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch QQQQ)...`);
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
    console.log(`\nPatch QQQQ complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
