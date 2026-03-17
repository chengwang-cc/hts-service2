#!/usr/bin/env ts-node
/**
 * Patch O2 — 2026-03-14:
 *
 * Clear and high-impact fixes after N2 (610/5000 = 12.20% blocked):
 *
 * 1. PHONE_CASE_INTENT: Add ch.39 to allowChapters.
 *    Phone cases are overwhelmingly ch.39 (plastic articles), not ch.42 (leather).
 *    'phone case' → 3920/3921/3926.xx (ch.39). 7 blocks.
 *
 * 2. DEVICE_CASE_INTENT: Add ch.39 and ch.94 to allowChapters.
 *    Same issue — tablet/phone cases are ch.39. Wooden phone holder = ch.94.
 *    8 blocks.
 *
 * 3. LEATHER_FOLIO_CROSSBODY_BAG_INTENT: Add ch.39/58/63/71 + noneOf.
 *    'wristlet' → silicone wristlet (ch.39), cotton wristlet (ch.63).
 *    'tote bag' → tapestry tote (ch.58). 'ring box' → silver ring box (ch.71).
 *    'coin purse' → plush fish coin purse keychain (ch.39).
 *    7 blocks.
 *
 * 4. AI_CH89_INFLATABLE_RAFT: noneOf for 'tube' as container/electronic.
 *    'tube' → dispenser (ch.39), DNA test tube (ch.39), tire tube (ch.40),
 *    radio vacuum tube (ch.85), tube socket (ch.85). 8 blocks.
 *
 * 5. QUILT_COMFORTER_INTENT: Add ch.52/58/63 to allowChapters.
 *    'quilt' → quilt cotton fabric (ch.52), quilt kit (ch.52), quilt label (ch.58),
 *    quilted table mat (ch.63). All quilt-related products. 7 blocks.
 *
 * 6. AI_CH13_NATURAL_GUMS_RESINS: Check and fix. 7 blocks.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14o2.ts
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

    // ── 1. PHONE_CASE_INTENT: add ch.39 ─────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'PHONE_CASE_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '39'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'PHONE_CASE_INTENT') +
              ' — Fixed O2: added ch.39 (plastic phone cases, the most common material)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`PHONE_CASE_INTENT: added ch.39`);
      } else { console.log('WARNING: PHONE_CASE_INTENT not found'); }
    }

    // ── 2. DEVICE_CASE_INTENT: add ch.39 and ch.94 ───────────────────────────
    {
      const existing = allRules.find(r => r.id === 'DEVICE_CASE_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '39', '94'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'DEVICE_CASE_INTENT') +
              ' — Fixed O2: added ch.39 (plastic device cases), ch.94 (wooden phone holder)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`DEVICE_CASE_INTENT: added ch.39/94`);
      } else { console.log('WARNING: DEVICE_CASE_INTENT not found'); }
    }

    // ── 3. LEATHER_FOLIO_CROSSBODY_BAG_INTENT: add ch.39/58/63/71 + noneOf ──
    {
      const existing = allRules.find(r => r.id === 'LEATHER_FOLIO_CROSSBODY_BAG_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add ch.39 (silicone/plastic wristlets/keychains), ch.58 (tapestry tote bags),
        // ch.63 (handmade textile bags), ch.71 (silver jewelry boxes/ring boxes)
        const newChapters = [...new Set([...currentChapters, '39', '58', '63', '71'])];
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Plush novelty coin purses (ch.39 - toy-like)
          'plush', 'kawaii', 'taiyaki', 'fish snack', 'snack bag',
          // Textile tote bags (not leather)
          'tapestry', 'cotton tote', 'canvas tote',
          // Wood ring boxes
          'wood ring box', 'wooden ring box', 'walnut ring box',
          // Paper wristlet phone connector
          'phone connector', 'phone wristlet patch', 'connector patch',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'LEATHER_FOLIO_CROSSBODY_BAG_INTENT') +
              ' — Fixed O2: added ch.39/58/63/71; noneOf plush/tapestry/wood ring box/phone connector',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`LEATHER_FOLIO_CROSSBODY_BAG_INTENT: added ch.39/58/63/71, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: LEATHER_FOLIO_CROSSBODY_BAG_INTENT not found'); }
    }

    // ── 4. AI_CH89_INFLATABLE_RAFT: noneOf for tube as container/electronic ──
    {
      const existing = allRules.find(r => r.id === 'AI_CH89_INFLATABLE_RAFT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Containers/dispensers
          'tube dispenser', 'dispenser', 'vials', 'vial', 'test tube', 'sample tube',
          'plastic tube', 'silicone tube', 'packaging tube',
          // Electronic vacuum tubes
          'radio tube', 'vacuum tube', 'tube valve', 'tube socket', 'pcb mount',
          'radio valve', 'valve socket', 'electron tube',
          // DNA/medical
          'dna', 'dna test', 'sterile sample',
          // Automotive/motorcycle tire tubes
          'tire tube', 'tyre tube', 'inner tube motorcycle', 'inner tube bike',
          // Bee/animal feeding
          'bee feeder', 'insect feeder', 'floater',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH89_INFLATABLE_RAFT') +
              ' — Fixed O2: noneOf tube-as-container/electronic/dna-sample/tire/bee-feeder',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH89_INFLATABLE_RAFT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH89_INFLATABLE_RAFT not found'); }
    }

    // ── 5. QUILT_COMFORTER_INTENT: add ch.52/58/63 ───────────────────────────
    {
      const existing = allRules.find(r => r.id === 'QUILT_COMFORTER_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add ch.52 (cotton quilting fabric), ch.58 (embroidered quilt labels), ch.63 (quilted table mats)
        const newChapters = [...new Set([...currentChapters, '52', '58', '63'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'QUILT_COMFORTER_INTENT') +
              ' — Fixed O2: added ch.52 (quilting cotton fabric), ch.58 (quilt labels), ch.63 (quilted mats)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`QUILT_COMFORTER_INTENT: added ch.52/58/63`);
      } else { console.log('WARNING: QUILT_COMFORTER_INTENT not found'); }
    }

    // ── 6. AI_CH13_NATURAL_GUMS_RESINS: check ────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH13_NATURAL_GUMS_RESINS') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        console.log(`AI_CH13_NATURAL_GUMS_RESINS: allowChapters=${JSON.stringify(wl.allowChapters)}, anyOf count=${(pat.anyOf ?? []).length}, anyOf first 5: ${JSON.stringify((pat.anyOf ?? []).slice(0, 5))}`);
        // If 'resin' is in anyOf, it matches many non-gum items (epoxy resin, resin art, etc.)
        // Add noneOf for synthetic resins and artistic uses
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'epoxy', 'epoxy resin', 'resin art', 'resin craft', 'resin mold',
          'synthetic resin', 'acrylic resin', 'polyester resin', 'uv resin',
          'vinyl resin', 'phenol resin', 'resin coating',
          'cement', 'concrete', 'mortar',
          'nails', 'tacks', 'drawing pins', 'staples',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH13_NATURAL_GUMS_RESINS') +
              ' — Fixed O2: noneOf epoxy/synthetic resin/cement/nails (synthetic/construction context)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH13_NATURAL_GUMS_RESINS: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('AI_CH13_NATURAL_GUMS_RESINS not found'); }
    }

    // ── Apply all patches ─────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch O2)...`);
    let applied = 0;
    let failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await (svc as any).upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
        applied++;
      } catch (err: any) {
        console.error(`  ❌ ${rule.id}: ${err.message}`);
        failed++;
      }
    }

    console.log(`\nPatch O2 complete: ${applied} applied, ${failed} failed`);
    console.log(`Rules in cache: ${(svc.getAllRules() as any[]).length}`);

  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
