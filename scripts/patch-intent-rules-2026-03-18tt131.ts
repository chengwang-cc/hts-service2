#!/usr/bin/env ts-node
/**
 * Patch TT131 — 2026-03-18:
 *
 * Fix 1: UPDATE STRETCH_LACE_TEXTILE_INTENT — add generic "lace trim" patterns
 *   "Lace Trim" → 5808.10.50.00 WRONG (expected 5804.21.00.00)
 *   Root cause: "lace trim" alone doesn't match "stretch lace trim" in anyOf.
 *
 * Fix 2: UPDATE STEEL_TIN_CAN_CONTAINER_INTENT — add wall art / sign to noneOf
 *   "wall art metal tin small 12x5 x0.25 inches." → 7310.21 WRONG (expected 9403.20)
 *   Root cause: "metal tin" in anyOf matches decorative wall art pieces.
 *
 * Fix 3: UPDATE DOG_TEXTILE_HARNESS_LEASH_INTENT — add traffic handle terms
 *   "Add A Biothane Traffic Handle To Your Leash" → 8211.93 WRONG (expected 4201.00.30.00)
 *   Root cause: "biothane handle" requires "biothane" directly adjacent to "handle"
 *   but "biothane traffic handle" has "traffic" between them.
 *
 * Fix 4: UPDATE MAGNETIC_NOVELTY_PLASTIC_INTENT — remove "magnetic dicks" from plastic rule
 *   "Bag of Magnetic Dicks | 3D Printed Gag Gift" → 3926.90 WRONG (expected 8505.19.30.00)
 *   Root cause: MAGNETIC_NOVELTY_PLASTIC_INTENT has "magnetic dicks" → plastic (ch39).
 *   Magnetic novelty items with magnets as primary component → 8505.19 (permanent magnets).
 *
 * Fix 5: UPDATE PERMANENT_MAGNET_INTENT — add novelty magnet patterns
 *   "Bag of Magnetic Dicks" → expected 8505.19.30.00 (permanent magnets)
 *   "magnetic novelty", "magnetic toy", "magnetic set" → 8505.19.
 *
 * Fix 6: NEW FABRIC_BIAS_TAPE_NARROW_WOVEN_INTENT → 5806
 *   "Floral Double Fold Fabric Bias Tape -1 yard, 1/2" wide" → 5204.20 WRONG (expected 5806.10.10.00)
 *   Root cause: bias tape (narrow woven fabric) misclassified as thread.
 *   5806 = narrow woven fabrics (bias tape, seam binding, ribbon of narrow width).
 *
 * Fix 7: UPDATE SOAP_PUMP_DISPENSER_INTENT — add 8413.19 inject for liquid pumps
 *   "plastic shampoo pump" → 8424.89 WRONG (expected 8413.19.00.00)
 *   Root cause: shampoo pumps are liquid pumps (8413.19), not appliances for spraying (8424).
 *   Note: soap foaming pumps and spray dispensers may correctly stay at 8424.89.
 *
 * Fix 8: NEW WINDOW_BLIND_SHADE_INTENT → 6303 (curtains/blinds/shades)
 *   "roller blind" → expected 6303.12 (curtains/window blinds of synthetic fiber), getting wrong code.
 *   6303 = curtains (including drapes) and interior blinds.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-18tt131.ts
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

    // 1. UPDATE STRETCH_LACE_TEXTILE_INTENT — add generic lace trim
    {
      const existing = allRules.find(r => r.id === 'STRETCH_LACE_TEXTILE_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const addAnyOf = [
          'lace trim', 'lace trimmings', 'cotton lace trim', 'crochet lace trim',
          'embroidery lace trim', 'flat lace trim', 'scallop lace trim',
          'raschel lace', 'eyelash lace', 'venice lace trim', 'chantilly lace trim',
          'lace border trim', 'lace edge trim', 'tulle lace trim', 'mesh lace trim',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...addAnyOf])],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 560, rule: updated });
        console.log('STRETCH_LACE_TEXTILE_INTENT: added generic lace trim phrases');
      } else {
        console.log('STRETCH_LACE_TEXTILE_INTENT: not found');
      }
    }

    // 2. UPDATE STEEL_TIN_CAN_CONTAINER_INTENT — add wall art/signs to noneOf
    {
      const existing = allRules.find(r => r.id === 'STEEL_TIN_CAN_CONTAINER_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const addNoneOf = [
          'wall art', 'tin sign', 'vintage sign', 'metal sign', 'art tin',
          'tin wall', 'sign tin', 'decorative tin sign', 'advertising sign',
          'wall sign', 'wall decor tin',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set([...currentNoneOf, ...addNoneOf])],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 400, rule: updated });
        console.log('STEEL_TIN_CAN_CONTAINER_INTENT: added wall art/sign to noneOf');
      } else {
        console.log('STEEL_TIN_CAN_CONTAINER_INTENT: not found');
      }
    }

    // 3. UPDATE DOG_TEXTILE_HARNESS_LEASH_INTENT — add traffic handle patterns
    {
      const existing = allRules.find(r => r.id === 'DOG_TEXTILE_HARNESS_LEASH_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const addAnyOf = [
          'traffic handle', 'biothane traffic', 'leash handle add',
          'handle add leash', 'traffic lead handle', 'short handle leash',
          'double handle leash', 'dual handle leash', 'handle attachment leash',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...addAnyOf])],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 540, rule: updated });
        console.log('DOG_TEXTILE_HARNESS_LEASH_INTENT: added traffic handle phrases');
      } else {
        console.log('DOG_TEXTILE_HARNESS_LEASH_INTENT: not found');
      }
    }

    // 4. UPDATE MAGNETIC_NOVELTY_PLASTIC_INTENT — remove magnetic items that are really magnets
    {
      const existing = allRules.find(r => r.id === 'MAGNETIC_NOVELTY_PLASTIC_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        // Remove magnetic terms - those belong in PERMANENT_MAGNET_INTENT
        const removals = new Set([
          '"magnetic dicks"', '"magnetic novelty"', '"novelty magnet"', '"funny gift magnet"',
        ]);
        const filteredAnyOf = currentAnyOf.filter((v: string) => !removals.has(JSON.stringify(v)));
        // Add noneOf to hard-block magnets from this plastic rule
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const addNoneOf = ['magnetic', 'magnet', 'magnets'];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: filteredAnyOf,
            noneOf: [...new Set([...currentNoneOf, ...addNoneOf])],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 400, rule: updated });
        console.log('MAGNETIC_NOVELTY_PLASTIC_INTENT: removed magnetic terms, added noneOf:[magnetic]');
      } else {
        console.log('MAGNETIC_NOVELTY_PLASTIC_INTENT: not found');
      }
    }

    // 5. UPDATE PERMANENT_MAGNET_INTENT — add novelty/gag magnet patterns
    {
      const existing = allRules.find(r => r.id === 'PERMANENT_MAGNET_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const addAnyOf = [
          'magnetic dicks', 'magnetic novelty', 'novelty magnet', 'gag gift magnet',
          'magnetic set', 'magnetic toys', 'magnetic building', 'magnet set',
          'magnet toy', 'magnet toys', 'craft magnet', 'hobby magnet',
          'button magnet', 'pin magnet', 'magnetic pin',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...addAnyOf])],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 400, rule: updated });
        console.log('PERMANENT_MAGNET_INTENT: added novelty/gag magnet patterns');
      } else {
        console.log('PERMANENT_MAGNET_INTENT: not found');
      }
    }

    // 6. NEW FABRIC_BIAS_TAPE_NARROW_WOVEN_INTENT → 5806
    //    Bias tape, seam binding, hem tape, fold-over elastic tape = narrow woven fabric (5806).
    //    Getting misclassified as thread (5204.20) or other fabric types.
    {
      const existing = allRules.find(r => r.id === 'FABRIC_BIAS_TAPE_NARROW_WOVEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FABRIC_BIAS_TAPE_NARROW_WOVEN_INTENT',
          description: 'Bias tape, seam binding, hem tape, narrow woven fabric → 5806',
          pattern: {
            anyOf: [
              // Bias tape
              'bias tape', 'bias tapes', 'fabric bias tape', 'double fold bias tape',
              'single fold bias tape', 'cotton bias tape', 'satin bias tape',
              'bias binding tape', 'bias cut tape',
              // Seam/hem binding
              'seam binding', 'hem tape', 'hem binding', 'seam tape',
              'sewn binding', 'seam finish tape',
              // Fold-over elastic (narrow, so 5806)
              'fold over elastic', 'fold-over elastic', 'foe elastic',
              // Other narrow fabric tapes
              'twill tape', 'cotton twill tape', 'seam tape cotton',
              'stay tape sewing', 'stay stitch tape',
            ],
            noneOf: [
              // Adhesive tapes (not fabric)
              'adhesive tape', 'duct tape', 'masking tape', 'scotch tape',
              'double sided tape', 'washi tape', 'self adhesive',
              // Wide fabric (not narrow)
              'yard of fabric', 'fabric bolt',
            ],
          },
          inject: [
            { prefix: '5806.32', syntheticRank: 1 },  // narrow woven fabrics of man-made fibers
            { prefix: '5806.10', syntheticRank: 4 },  // narrow woven fabrics of silk
            { prefix: '5806.39', syntheticRank: 7 },  // narrow woven fabrics of other textile
          ],
          whitelist: {
            allowChapters: ['58'],  // special textile fabrics
          },
          boosts: [
            { delta: 0.85, prefixMatch: '5806.' },
            { delta: 0.70, prefixMatch: '5806.32' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '5204.' },  // penalize embroidery thread
            { delta: 0.80, prefixMatch: '5205.' },  // penalize cotton yarn
            { delta: 0.75, prefixMatch: '5808.' },  // penalize braids/trimming
          ],
        } as IntentRule;
        patches.push({ priority: 631, rule: newRule });
        console.log('FABRIC_BIAS_TAPE_NARROW_WOVEN_INTENT: created (→5806, allowChapters:[58])');
      } else {
        console.log('FABRIC_BIAS_TAPE_NARROW_WOVEN_INTENT: already exists, skipping');
      }
    }

    // 7. UPDATE SOAP_PUMP_DISPENSER_INTENT — add 8413.19 for non-spray liquid pumps
    //    Lotion/shampoo/conditioner pumps = liquid pumps (8413.19), not sprayers (8424.89).
    {
      const existing = allRules.find(r => r.id === 'SOAP_PUMP_DISPENSER_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const updated = {
          ...existing,
          inject: [
            { prefix: '8413.19', syntheticRank: 1 },  // other pumps for liquids (shampoo/lotion pumps)
            { prefix: '8424.89', syntheticRank: 5 },  // appliances for spraying (foam/spray dispensers)
          ],
          whitelist: {
            allowChapters: ['84'],
          },
          boosts: [
            { delta: 0.85, prefixMatch: '8413.19' },
            { delta: 0.60, prefixMatch: '8424.89' },
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 540, rule: updated });
        console.log('SOAP_PUMP_DISPENSER_INTENT: updated inject→8413.19 rank1');
      } else {
        console.log('SOAP_PUMP_DISPENSER_INTENT: not found');
      }
    }

    // 8. NEW WINDOW_BLIND_SHADE_DRAPE_INTENT → 6303
    //    Window blinds, roller blinds, Roman shades, curtains, drapes → 6303 (household textiles).
    {
      const existing = allRules.find(r => r.id === 'WINDOW_BLIND_SHADE_DRAPE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WINDOW_BLIND_SHADE_DRAPE_INTENT',
          description: 'Window blinds, roller blinds, Roman shades, curtains → 6303 (interior blinds)',
          pattern: {
            anyOf: [
              // Roller/Roman blinds
              'roller blind', 'roller blinds', 'roman blind', 'roman blinds',
              'roman shade', 'roman shades', 'window blind', 'window blinds',
              'cellular blind', 'pleated blind', 'panel blind',
              // Curtains/drapes
              'window curtain', 'window curtains', 'window drape', 'window drapes',
              'curtain panel', 'curtain panels', 'blackout curtain', 'blackout curtains',
              'sheer curtain', 'linen curtain', 'velvet curtain', 'thermal curtain',
              'door curtain', 'shower curtain liner',
              // Shades
              'window shade', 'window shades', 'solar shade', 'woven wood shade',
            ],
            noneOf: [
              // Non-window items
              'eye shade', 'eye mask', 'lamp shade', 'lampshade',
              'shade cloth', 'shade sail', 'car sun shade',
              // Venetian/wood slat blinds (different: mostly wood/metal)
              'venetian blind', 'mini blind', 'faux wood blind', 'wood blind',
            ],
          },
          inject: [
            { prefix: '6303.12', syntheticRank: 1 },  // curtains/interior blinds of synthetic fiber
            { prefix: '6303.91', syntheticRank: 4 },  // curtains/blinds of cotton
            { prefix: '6303.19', syntheticRank: 7 },  // curtains/blinds of other textiles
          ],
          whitelist: {
            allowChapters: ['63'],  // household textile articles
          },
          boosts: [
            { delta: 0.85, prefixMatch: '6303.' },
            { delta: 0.70, prefixMatch: '6303.12' },
          ],
          penalties: [
            { delta: 0.80, prefixMatch: '6302.' },  // penalize bed linen
            { delta: 0.75, prefixMatch: '7321.' },  // penalize stoves/heaters
          ],
        } as IntentRule;
        patches.push({ priority: 632, rule: newRule });
        console.log('WINDOW_BLIND_SHADE_DRAPE_INTENT: created (→6303, allowChapters:[63])');
      } else {
        console.log('WINDOW_BLIND_SHADE_DRAPE_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT131)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT131 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
