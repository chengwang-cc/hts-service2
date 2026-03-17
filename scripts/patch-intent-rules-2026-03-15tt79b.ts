#!/usr/bin/env ts-node
/**
 * Patch TT79b — 2026-03-15: Fix ENAMEL_DECORATIVE_PIN_INTENT regression.
 *
 * Regression found in TT78:
 *  ENAMEL_DECORATIVE_PIN_INTENT added 'lobster clasp', 'toggle clasp', etc. (clasp fasteners)
 *  "Acrylic charm, 2.5" tall, with lobster clasp, consisting of plastic" → 7319 WRONG (expected 3906.90)
 *  BUG: 'lobster clasp' in anyOf + allowChapters:['73','74'] blocks ch.39 (plastic)
 *       Acrylic charms WITH lobster clasps should be in ch.39 (plastic articles), not ch.73 (steel pins)
 *  FIX: Remove clasp/fastener terms from ENAMEL_DECORATIVE_PIN_INTENT
 *       Add 'plastic', 'acrylic', 'resin' to noneOf to prevent plastic items from matching
 *       Keep only true enamel/lapel/brooch pin terms
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt79b.ts
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

    // Fix ENAMEL_DECORATIVE_PIN_INTENT — remove clasp terms, add plastic noneOf
    // "Acrylic charm with lobster clasp" → 7319 WRONG because 'lobster clasp' in anyOf
    // Fix: Replace anyOf with enamel/pin-specific terms only; add plastic to noneOf
    {
      const existing = allRules.find(r => r.id === 'ENAMEL_DECORATIVE_PIN_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          pattern: {
            anyOf: [
              // Enamel pins only
              'enamel pin', 'enamel pins', 'hard enamel pin', 'soft enamel pin',
              'enamel lapel pin', 'enamel badge', 'cloisonne pin',
              // Baby/keepsake pins
              'baby pin', 'baby brooch', 'baby keepsake pin', 'newborn pin',
              // Lapel/hat pins (not with lobster clasp - that's jewelry finding)
              'lapel pin', 'lapel pins', 'hat pin', 'hat pins',
              'tie pin', 'tie tack', 'stick pin',
              // Flag pins
              'flag lapel pin', 'flag pin', 'flag enamel pin',
              // Copper/brass clasps for garments (not jewelry findings)
              'copper clasp', 'copper brooch', 'copper cardigan clasp',
              'brass clasp', 'brass brooch', 'metal cardigan clasp',
              'cardigan clasp', 'shawl clasp', 'cape clasp',
              'sweater clasp', 'cloak clasp',
            ],
            noneOf: [
              // Exclude precious metal jewelry
              'gold pin', 'silver pin', 'gold brooch', 'sterling brooch',
              // Exclude functional safety pins
              'diaper pin', 'kilt pin', 'safety pin',
              // Exclude hair accessories
              'hair pin', 'bobby pin', 'hairpin',
              // Exclude sewing pins
              'sewing pin', 'dressmaker pin', 'straight pin',
              // Exclude plastic/acrylic items with clasps (NEW)
              'acrylic', 'plastic', 'resin', 'pvc',
              // Exclude jewelry findings
              'lobster clasp', 'toggle clasp', 'hook and eye clasp',
            ],
          },
          // Keep allowChapters:['73','74'] for iron/steel and copper
          whitelist: {
            allowChapters: ['73', '74'],
            denyChapters: ['71', '83', '96'],
          },
        } as IntentRule;
        await svc.upsertRule(updated, 568);
        console.log('✅ ENAMEL_DECORATIVE_PIN_INTENT: removed lobster clasp, added plastic to noneOf');
        console.log('   Acrylic charms with lobster clasp → ch.39 (correct, was 7319)');
      } else {
        console.log('❌ ENAMEL_DECORATIVE_PIN_INTENT: not found');
      }
    }

    console.log('\nTT79b complete');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
