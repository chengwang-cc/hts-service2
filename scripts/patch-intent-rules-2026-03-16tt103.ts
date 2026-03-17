#!/usr/bin/env ts-node
/**
 * Patch TT103 — 2026-03-16: Phone cases ch.39, pillow covers 6302, auto trim panels.
 *
 * Fix 1: NEW PLASTIC_PHONE_CASE_INTENT → 3921.19/3920.61 (plastic sheets/film, ch.39)
 *   "phone case" → 4202 WRONG (expected 3921.19)
 *   "Mobile phone case" → 4202 WRONG (expected 3921.19)
 *   "Clear Series Phone Case - iPhone 12" → 4202 WRONG (expected 3920.61)
 *   ROOT CAUSE: DEVICE_CASE_INTENT injects 4202 (ch.42) + allowChapters:['42','39','94']
 *   FIX: New intent at higher priority (510 > 500) with denyChapters:['42']. The denyChapters
 *   AND logic overrides DEVICE_CASE_INTENT's allowChapters:['42'] when both fire.
 *
 * Fix 2: UPDATE COTTON_PILLOW_COVER_BED_INTENT — stronger injection + penalties
 *   "DECORATIVE RED COTTON THROW PILLOW COVER" → 6304.99 WRONG (expected 6302.21.30)
 *   "Handmade pillows" → 6307.90 WRONG (expected 6302.21)
 *   ROOT CAUSE: inject rank 5 is too low; 6304 organic results outcompete 6302 injection.
 *   FIX: Raise injection rank to 2. Add penalty for 6304/9404/6307 chapters.
 *
 * Fix 3: UPDATE AUTOMOTIVE_BODY_PARTS_INTENT — add missing trim panel phrases
 *   "Car Plastic Trim Panel" → 8708.99 (expected 8708.29.51)
 *   "Automotive Plastic Trim Panel" → 8708.99 (expected 8708.29.25)
 *   ROOT CAUSE: "car plastic trim panel" doesn't match "car trim panel" (word "plastic" breaks match)
 *   FIX: Add "car plastic trim", "automotive plastic trim", "plastic trim panel", etc. to anyOf
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt103.ts
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

    // 1. NEW PLASTIC_PHONE_CASE_INTENT — phone cases → ch.39, deny ch.42
    //    "phone case" / "Mobile phone case" → 4202 WRONG (expected 3921.19)
    //    "Acuna Jr. (CC) Clear Series Phone Case - iPhone 12" → 4202 WRONG (expected 3920.61)
    //    Root cause: DEVICE_CASE_INTENT (priority 500) injects 4202 + allows ch.42.
    //    Fix: Priority 510 > 500, denyChapters:['42'] — blocks ch.42 via AND logic even when
    //    DEVICE_CASE_INTENT fires simultaneously with allowChapters:['42'].
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_PHONE_CASE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_PHONE_CASE_INTENT',
          description: 'Plastic/silicone phone cases → 3921.19/3920.61 (plastic sheets, ch.39), deny ch.42 luggage',
          pattern: {
            anyOf: [
              'phone case', 'phone cases', 'iphone case', 'iphone cases',
              'mobile phone case', 'cellphone case', 'cell phone case',
              'silicone phone case', 'clear phone case', 'plastic phone case',
              'phone cover', 'mobile cover', 'iphone cover',
              'smartphone case', 'android phone case',
            ],
            noneOf: [
              // Exclude non-plastic cases (leather, fabric, wood → ch.42 or ch.44)
              'leather case', 'leather phone case', 'wallet case',
              'wood phone case', 'wooden phone case', 'fabric phone case',
              // Keep custom cases out (custom printing → ch.42)
              'custom phone case',
            ],
          },
          inject: [
            { prefix: '3921.19', syntheticRank: 2 },  // cellular plastic sheets/cases
            { prefix: '3920.61', syntheticRank: 4 },  // transparent plastic film/cases
            { prefix: '3926.90', syntheticRank: 6 },  // other articles of plastics
          ],
          whitelist: {
            denyChapters: ['42'],                      // deny luggage/case goods
          },
          boosts: [
            { delta: 0.70, chapterMatch: '39' },       // boost plastics chapter
            { delta: 0.50, prefixMatch: '3921.' },     // boost cellular plastic
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '42' },       // strong penalty for luggage
          ],
        } as IntentRule;
        patches.push({ priority: 510, rule: newRule });
        console.log('PLASTIC_PHONE_CASE_INTENT: created (phone cases → 3921.19, deny ch.42)');
      } else {
        console.log('PLASTIC_PHONE_CASE_INTENT: already exists, skipping');
      }
    }

    // 2. UPDATE COTTON_PILLOW_COVER_BED_INTENT — stronger injection + penalties
    //    "DECORATIVE RED COTTON THROW PILLOW COVER" → 6304.99 (expected 6302.21.30.40)
    //    "Handmade pillows" → 6307.90 (expected 6302.21.30.40)
    //    "pillow case"/"pillow cover" → 6302.22.20 instead of 6302.21.90 (within 6302, close)
    //    Root cause: inject rank 5 too low; organic 6304/9404 results rank higher.
    //    Fix: raise inject to rank 2 for 6302.21, add penalties for competing chapters.
    {
      const existing = allRules.find(r => r.id === 'COTTON_PILLOW_COVER_BED_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '6302.21', syntheticRank: 2 },   // woven cotton pillow cases (rank up from 5)
            { prefix: '6302.22', syntheticRank: 4 },   // add: printed cotton pillow cases
            { prefix: '6302.31', syntheticRank: 6 },   // add: other cotton bed linen
          ],
          boosts: [
            { delta: 0.75, prefixMatch: '6302.' },      // boost bed linen
            { delta: 0.40, chapterMatch: '63' },
          ],
          penalties: [
            { delta: 0.60, prefixMatch: '6304.' },      // penalty for other furnishing articles
            { delta: 0.70, prefixMatch: '9404.' },      // penalty for mattresses/quilts
            { delta: 0.40, prefixMatch: '6307.' },      // penalty for misc textile articles
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 565, rule: updated });
        console.log('COTTON_PILLOW_COVER_BED_INTENT: raised injection rank 5→2, added penalties for 6304/9404/6307');
      } else {
        console.log('COTTON_PILLOW_COVER_BED_INTENT: not found');
      }
    }

    // 3. UPDATE AUTOMOTIVE_BODY_PARTS_INTENT — add missing trim panel phrases
    //    "Car Plastic Trim Panel" → 8708.99 (expected 8708.29.51) - no intent match because
    //    "car plastic trim panel".includes("car trim panel") = false (word "plastic" breaks match)
    //    "Automotive Plastic Trim Panel" → same issue
    //    Fix: add "plastic trim panel", "car plastic trim", "automotive plastic trim" etc. to anyOf
    {
      const existing = allRules.find(r => r.id === 'AUTOMOTIVE_BODY_PARTS_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          // Plastic trim panel variations (with "plastic" between car and trim)
          'plastic trim panel', 'plastic trim piece', 'plastic body panel',
          'car plastic trim', 'automotive plastic trim',
          'abs plastic trim', 'abs trim panel',
          // License plate
          'license plate delete', 'license plate blank', 'plate delete',
          // Additional body parts not in current list
          'car grille', 'front grille', 'front bumper cover', 'rear bumper cover',
          'car spoiler', 'trunk spoiler', 'abs plastic spoiler',
          'floor liner', 'floor mat liner', 'cargo liner',
          // Horn pad
          'horn pad', 'steering horn pad', 'airbag horn pad',
          // Door panel
          'door panel', 'car door panel',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
          // Also boost 8708.29 more strongly
          inject: [
            { prefix: '8708.29', syntheticRank: 2 },   // body parts (raised from 9 - rank 2 = higher)
            { prefix: '8708.99', syntheticRank: 5 },
            { prefix: '3926.30', syntheticRank: 8 },
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 568, rule: updated });
        console.log('AUTOMOTIVE_BODY_PARTS_INTENT: added plastic trim panel phrases, raised 8708.29 injection rank');
      } else {
        console.log('AUTOMOTIVE_BODY_PARTS_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT103)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT103 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
