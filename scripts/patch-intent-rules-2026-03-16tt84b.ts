#!/usr/bin/env ts-node
/**
 * Patch TT84b — 2026-03-16: Revert TT84 sticker changes.
 *
 * Regression from TT84:
 *  TT84 created PLASTIC_ADHESIVE_STICKER_INTENT with 'vinyl sticker', 'vinyl decal', etc.
 *  But the dataset treats "vinyl sticker" / "vinyl decal" as ch.48/49 (printed matter),
 *  not ch.39 (raw plastic). Queries like:
 *    "Vinyl Sticker" → exp:4811.41.30 (coated paper) — now wrongly goes to 3919
 *    "dog Vinyl Sticker" → exp:4911.91 — now wrongly goes to 3919
 *    "100% Vinyl sticker made in Canada" → exp:4908.90 — now wrongly goes to 3919
 *  TT84 also removed 'vinyl sticker' from STICKER_LABEL_INTENT anyOf and added plastic noneOf
 *  causing further misroutes.
 *
 *  Fix:
 *  1. Disable PLASTIC_ADHESIVE_STICKER_INTENT (set anyOf to non-matching token)
 *  2. Restore STICKER_LABEL_INTENT: add 'vinyl sticker' back to anyOf, remove plastic noneOf
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt84b.ts
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

    // 1. Disable PLASTIC_ADHESIVE_STICKER_INTENT — revert TT84
    //    The dataset classifies "vinyl sticker", "vinyl decal" as ch.48/49 (printed matter),
    //    not ch.39 (raw plastic self-adhesive sheets). TT84's broad anyOf caused ~10 regressions.
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_ADHESIVE_STICKER_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: ['__DISABLED_TT84B_DO_NOT_MATCH__'],  // never matches any real query
          },
        } as IntentRule;
        await svc.upsertRule(updated, (existing as any).priority ?? 554);
        console.log('✅ PLASTIC_ADHESIVE_STICKER_INTENT: disabled (anyOf set to non-matching token)');
      } else {
        console.log('❌ PLASTIC_ADHESIVE_STICKER_INTENT: not found');
      }
    }

    // 2. Restore STICKER_LABEL_INTENT — add 'vinyl sticker' back to anyOf, remove plastic noneOf
    //    TT84 removed 'vinyl sticker' from anyOf and added acrylic/vinyl/pvc/plastic/holographic
    //    terms to noneOf. These changes caused many correct sticker queries to miss ch.48/49 results.
    {
      const existing = allRules.find(r => r.id === 'STICKER_LABEL_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const currentNoneOf = (existing as any).pattern?.noneOf || [];

        // Add vinyl sticker back if not present
        const restoredAnyOf = currentAnyOf.includes('vinyl sticker')
          ? currentAnyOf
          : [...currentAnyOf, 'vinyl sticker'];

        // Remove the plastic noneOf additions from TT84
        const tt84NoneOfAdditions = new Set([
          'acrylic sticker', 'acrylic stickers', 'acrylic label',
          'vinyl sticker', 'vinyl stickers', 'vinyl label', 'vinyl labels',
          'pvc sticker', 'pvc stickers', 'pvc label',
          'plastic sticker', 'plastic stickers', 'plastic label sticker',
          'silicone sticker', 'resin sticker',
          'holographic sticker', 'foil sticker',
          'acrylic bookmark', 'acrylic keychains with stickers',
        ]);
        const restoredNoneOf = currentNoneOf.filter((t: string) => !tt84NoneOfAdditions.has(t));

        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: restoredAnyOf,
            noneOf: restoredNoneOf,
          },
        } as IntentRule;
        await svc.upsertRule(updated, (existing as any).priority ?? 500);
        console.log(`✅ STICKER_LABEL_INTENT: restored 'vinyl sticker' to anyOf, removed ${currentNoneOf.length - restoredNoneOf.length} plastic noneOf terms`);
      } else {
        console.log('❌ STICKER_LABEL_INTENT: not found');
      }
    }

    console.log('\nTT84b complete');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
