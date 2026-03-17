#!/usr/bin/env ts-node
/**
 * Patch TT113 — 2026-03-16: Add USB_FLASH_DRIVE_INTENT + VINYL_RECORD_PHONOGRAPH_INTENT.
 *
 * Fix 1: NEW USB_FLASH_DRIVE_INTENT → 8523.51.00.00 (solid-state storage)
 *   "128 GB PNY USB Drive" → 8544 (wiring) WRONG (expected 8523.51.00.00)
 *   "16 GB Kootion USB Drive" → 8544 WRONG (expected 8523.51.00.00)
 *   Root cause: no intent rule for USB flash drives; "USB" + "drive" triggers wiring/cable codes.
 *   Fix: New intent with strong inject at rank 1 for 8523.51.
 *
 * Fix 2: NEW VINYL_RECORD_PHONOGRAPH_INTENT → 8523.80.10.00 (phonograph records)
 *   "12\" Vinyl Record" → 8523.29 (magnetic tape) WRONG (expected 8523.80.10.00)
 *   "7\" Vinyl Record" → 8523.29 WRONG (expected 8523.80.10.00)
 *   Root cause: AUDIO_MEDIA_CD_CASSETTE_INTENT + CASSETTE_TAPE_VINYL_VHS_INTENT inject 8523.29
 *   (magnetic tape) for all vinyl queries, not 8523.80 (phonograph records/vinyl discs).
 *   Fix: New dedicated intent for vinyl record disc queries with inject 8523.80.10 at rank 1.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt113.ts
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

    // 1. NEW USB_FLASH_DRIVE_INTENT → 8523.51.00.00 (solid-state non-volatile storage)
    //    "usb drive", "flash drive", "thumb drive", "memory stick" queries return 8544 (wiring).
    //    USB flash drives are 8523.51.00.00 "Solid-state non-volatile storage devices".
    //    Note: exclude USB hard drives (HDD) and audio/video media context.
    {
      const existing = allRules.find(r => r.id === 'USB_FLASH_DRIVE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'USB_FLASH_DRIVE_INTENT',
          description: 'USB flash drives, thumb drives → 8523.51.00.00 (solid-state storage), deny wiring',
          pattern: {
            anyOf: [
              'usb drive', 'usb flash drive', 'usb flash',
              'flash drive', 'thumb drive', 'memory stick',
              'usb memory', 'pen drive',
            ],
            noneOf: [
              // USB hard drives → different intent (hard drive HDD)
              'hard drive', 'hard disk', 'hdd',
              // Audio/video context handled by media intents
              'audio drive', 'cd drive', 'dvd drive',
            ],
          },
          inject: [
            { prefix: '8523.51', syntheticRank: 1 },  // solid-state non-volatile storage (USB flash drives)
          ],
          whitelist: {
            denyPrefixes: ['8544.'],    // block wiring/cable codes
          },
          boosts: [
            { delta: 0.95, prefixMatch: '8523.51' },  // very strong boost for flash storage
            { delta: 0.50, prefixMatch: '8523.' },     // general storage media boost
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '8544.' },  // strong penalty for wiring
          ],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('USB_FLASH_DRIVE_INTENT: created (usb drive → 8523.51.00.00, denyPrefixes:[8544.])');
      } else {
        console.log('USB_FLASH_DRIVE_INTENT: already exists, skipping');
      }
    }

    // 2. NEW VINYL_RECORD_PHONOGRAPH_INTENT → 8523.80.10.00 (phonograph records)
    //    "12\" Vinyl Record", "7\" Vinyl Record" → 8523.29 WRONG (expected 8523.80.10.00).
    //    AUDIO_MEDIA_CD_CASSETTE_INTENT and CASSETTE_TAPE_VINYL_VHS_INTENT inject 8523.29
    //    (magnetic tape) for vinyl queries, but phonograph vinyl records = 8523.80.10.
    //    Note: "Vinyl - COED" expects 8523.29 (magnetic tape with vinyl label) — keep noneOf.
    {
      const existing = allRules.find(r => r.id === 'VINYL_RECORD_PHONOGRAPH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'VINYL_RECORD_PHONOGRAPH_INTENT',
          description: 'Vinyl record discs (phonograph) → 8523.80.10.00, not magnetic tape 8523.29',
          pattern: {
            anyOf: [
              'vinyl record', 'vinyl records',
              '12" vinyl', '7" vinyl', '10" vinyl',
              '12 inch vinyl', '7 inch vinyl',
              'lp vinyl record', 'vinyl lp record',
              'phonograph record',
            ],
            noneOf: [
              // Exclude magnetic tape items labeled "vinyl"
              'vinyl flooring', 'vinyl floor', 'vinyl decal', 'vinyl sticker',
              'vinyl wrap', 'vinyl banner', 'vinyl siding', 'vinyl tablecloth',
              // These "vinyl" items are magnetic tape cassettes, not disc records
              'vinyl coed', 'vinyl - coed',
            ],
          },
          inject: [
            { prefix: '8523.80.10', syntheticRank: 1 },  // phonograph records (vinyl discs)
            { prefix: '8523.80.20', syntheticRank: 3 },  // other phonograph records
          ],
          boosts: [
            { delta: 0.95, prefixMatch: '8523.80' },  // very strong boost for phonograph records
            { delta: 0.50, prefixMatch: '8523.' },     // general media boost
          ],
          penalties: [
            { delta: 0.80, prefixMatch: '8523.29' },  // penalty for magnetic tape (wrong for vinyl disc)
          ],
        } as IntentRule;
        patches.push({ priority: 573, rule: newRule });
        console.log('VINYL_RECORD_PHONOGRAPH_INTENT: created (vinyl record → 8523.80.10.00, penalty:8523.29)');
      } else {
        console.log('VINYL_RECORD_PHONOGRAPH_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT113)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT113 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
