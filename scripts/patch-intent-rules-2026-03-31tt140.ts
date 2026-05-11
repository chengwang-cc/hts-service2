#!/usr/bin/env ts-node
/**
 * Patch TT140 — 2026-03-31: Fix trading-card plural + cocktail shaker
 *
 * Problem 1: "10 hockey cards" → gets 3926.90 (plastic cards) instead of 4911.99
 *   Root cause: TRADING_CARD_INTENT uses required:["card"] but "hockey cards" (plural)
 *   tokenizes to {"hockey","cards"} — tokens.has("card") is FALSE.
 *   Fix: replace required:["card"] with anyOfGroups:[["card","cards"]] so plural works.
 *   Also add "one piece" phrase to anyOf so "custom one piece don!! cards" fires the rule.
 *
 * Problem 2: "Cocktail Shaker Vintage" → gets 2208.90 (spirits) instead of 9617.00.10
 *   Root cause: no intent fires; semantic search surfaces premixed cocktails.
 *   Fix: add "cocktail shaker"/"cocktail shakers" to THERMOS_INTENT anyOf so it
 *   injects 9617.00 and applies allowChapters:["96"].
 *
 * Expected gain: ~3 hits (hockey cards, one-piece don!! cards, cocktail shaker).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-31tt140.ts
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

    // ── Fix 1: TRADING_CARD_INTENT ─────────────────────────────────────────────
    // Replace required:["card"] with anyOfGroups:[["card","cards"]] so plural queries
    // like "10 hockey cards" fire the rule. Also add "one piece" to anyOf for
    // One Piece TCG queries ("custom one piece don!! cards").
    {
      const existing = allRules.find(r => r.id === 'TRADING_CARD_INTENT');
      if (existing) {
        const currentAnyOf = existing.pattern.anyOf ?? [];
        const newAnyOf = currentAnyOf.includes('one piece')
          ? currentAnyOf
          : [...currentAnyOf, 'one piece'];

        const updated: IntentRule = {
          ...existing,
          pattern: {
            // Remove required:["card"] — replaced by anyOfGroups below
            anyOf: newAnyOf,
            anyOfGroups: [['card', 'cards']],
            noneOf: existing.pattern.noneOf,
          },
        };
        patches.push({ priority: 0, rule: updated });
        console.log(
          'TRADING_CARD_INTENT: replaced required:["card"] with anyOfGroups:[["card","cards"]], added "one piece" to anyOf',
        );
      } else {
        console.log('TRADING_CARD_INTENT: not found, skipping');
      }
    }

    // ── Fix 2: THERMOS_INTENT ──────────────────────────────────────────────────
    // "Cocktail Shaker Vintage" expects 9617.00.10. The cocktail shaker is a metal
    // mixing vessel; USITC classifies vintage/insulated shakers under 9617 (vacuum
    // vessels). THERMOS_INTENT already injects 9617.00 + allowChapters:["96"] —
    // just add the cocktail shaker phrases to its anyOf.
    {
      const existing = allRules.find(r => r.id === 'THERMOS_INTENT');
      if (existing) {
        const newPhrases = ['cocktail shaker', 'cocktail shakers', 'bar cocktail shaker'];
        const currentAnyOf = existing.pattern.anyOf ?? [];
        const toAdd = newPhrases.filter(p => !currentAnyOf.includes(p));
        if (toAdd.length > 0) {
          const updated: IntentRule = {
            ...existing,
            pattern: {
              ...existing.pattern,
              anyOf: [...currentAnyOf, ...toAdd],
            },
          };
          patches.push({ priority: 0, rule: updated });
          console.log(`THERMOS_INTENT: adding [${toAdd.join(', ')}] to anyOf`);
        } else {
          console.log('THERMOS_INTENT: cocktail shaker phrases already present, skipping');
        }
      } else {
        console.log('THERMOS_INTENT: not found, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT140)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ ${rule.id}: ${msg}`);
      }
    }
    console.log(`\nPatch TT140 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
