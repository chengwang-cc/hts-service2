#!/usr/bin/env ts-node
/**
 * Patch NN2 — 2026-03-14: Current: 2/5000 = 0.04%.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14nn2.ts
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

    const addCh = (e: IntentRule, ...chs: string[]) => {
      const wl = (e.whitelist as any) ?? {};
      return { ...wl, allowChapters: [...new Set([...(wl.allowChapters ?? []), ...chs])] };
    };
    const addNo = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, noneOf: [...new Set([...(pat.noneOf ?? []), ...terms])] };
    };

    // 1. STANDING_DESK_INTENT: noneOf desk-phone/speaker-phone (phone uses "office desk" but is ch.85)
    {
      const e = allRules.find(r => r.id === 'STANDING_DESK_INTENT');
      if (e) {
        const pat = addNo(e,
          'desk phone', 'speaker phone', 'speakerphone', 'landline phone',
          'corded phone', 'office phone', 'telephone',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log('STANDING_DESK_INTENT: noneOf desk-phone/speaker-phone/telephone');
      }
    }

    // 2. HARD_DRIVE_INTENT: add ch.85 (hard drive ribbon/flex cable = printed circuit ch.85)
    {
      const e = allRules.find(r => r.id === 'HARD_DRIVE_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '85') } });
        console.log('HARD_DRIVE_INTENT: added ch.85 (ribbon/flex cable = printed circuit)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch NN2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch NN2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
