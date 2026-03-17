#!/usr/bin/env ts-node
/**
 * Patch TTTT — 2026-03-14:
 *
 * noneOf fixes (2 rules):
 * 1. AI_CH75_NICKEL_MESH_CLOTH: add screen protector/tempered glass context
 *    "iPhone Air Tempered Glass Screen Protector" → ch.70 (7007.19) but 'screen' in anyOf blocks it
 * 2. BONE_CHINA_CERAMIC_DISHWARE_INTENT: add crystal/crystal figurine context
 *    "crystal figurine" → ch.70 (7001) but 'figurine' in anyOf blocks it
 *
 * anyOf additions (1 rule):
 * 3. STICKER_SHEET_PAPER_INTENT: add plain 'sticker'/'stickers' to anyOf
 *    "Silly Persona 3 Stickers" → ch.48 expected but no rule fires (only multi-word phrases in anyOf)
 *
 * New rules (3):
 * 4. STAINED_GLASS_FLAT_INTENT (ch.70): stained glass suncatcher/ornament → 7003.19
 *    "stained glass chickadee suncatcher" → 7003.19; no rules fire, wrong chapter
 * 5. TEMPERED_GLASS_SCREEN_INTENT (ch.70): tempered glass screen protector → 7007.19
 *    "iPhone tempered glass screen protector" → 7007.19; blocked by AI_CH75_NICKEL_MESH_CLOTH ('screen')
 * 6. GLASS_ROD_LAMPWORK_INTENT (ch.70): glass rod, lampwork glass → 7002.20
 *    "Creation is Messy glass rods" → 7002.20; no rules fire
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14tttt.ts
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
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed TTTT: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

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

    // ── 1. AI_CH75_NICKEL_MESH_CLOTH: 'screen' fires for screen protectors ────
    // "iPhone Air Tempered Glass Screen Protector" → expects ch.70 (7007.19)
    // 'screen' is in anyOf of this rule → blocks ch.70 results
    addNoneOf('AI_CH75_NICKEL_MESH_CLOTH', [
      'screen protector', 'tempered glass screen', 'phone screen', 'screen guard',
      'glass protector', 'iphone screen', 'ipad screen', 'phone glass',
      'tempered glass', 'glass screen',
    ], 'screen protector/tempered glass context prevents nickel mesh rule from blocking ch.70 glass screen protectors');

    // ── 2. BONE_CHINA_CERAMIC_DISHWARE_INTENT: 'figurine' fires for crystal figurines ─
    // "crystal figurine" → expects ch.70 (7001.xx glass figurines)
    // 'figurine' is in anyOf → blocks ch.70 results (rule has allowChapters=['69'])
    addNoneOf('BONE_CHINA_CERAMIC_DISHWARE_INTENT', [
      'crystal', 'crystal figurine', 'glass crystal', 'lead crystal',
      'glass figurine', 'crystal ornament', 'glass ornament', 'glass sculpture',
    ], 'crystal/glass figurine context prevents ceramic dishware rule from blocking ch.70 crystal/glass figurines');

    // ── 3. STICKER_SHEET_PAPER_INTENT: add plain sticker/stickers to anyOf ────
    // "Silly Persona 3 Stickers" → expects ch.48 (4802.55) but no rule fires
    // Current anyOf only has multi-word phrases like 'sticker sheet', not plain 'sticker'
    addToAnyOf('STICKER_SHEET_PAPER_INTENT', [
      'sticker', 'stickers', 'fan art sticker', 'video game sticker',
      'character sticker', 'anime sticker set', 'game sticker',
    ], 'add plain sticker/stickers so single-sticker-word queries match ch.48');

    // ── 4. NEW STAINED_GLASS_FLAT_INTENT ─────────────────────────────────────
    // "stained glass chickadee suncatcher" → 7003.19 (cast/rolled glass, not worked)
    // "stained glass panel", "suncatcher", "sun catcher" → ch.70
    // No rules fire for stained glass craft items
    patches.push({
      priority: 564,
      rule: {
        id: 'STAINED_GLASS_FLAT_INTENT',
        description: 'Stained glass panels, suncatchers, and flat glass art → ch.70 (7003.19). ' +
          '"Stained glass suncatcher", "stained glass panel", "sun catcher ornament" → 7003.19. ' +
          'Without rule, no ch.70 results for stained glass craft/art queries.',
        pattern: {
          anyOf: [
            'stained glass', 'suncatcher', 'sun catcher', 'stained glass panel',
            'stained glass window', 'stained glass ornament', 'glass suncatcher',
            'glass sun catcher', 'glass panel art', 'glass art panel',
            'leaded glass', 'tiffany glass', 'glass mosaic',
          ],
          noneOf: ['paint', 'painting kit', 'stained wood', 'stain kit'],
        },
        whitelist: { allowChapters: ['70'] },
        inject: [
          { prefix: '7003.19', syntheticRank: 9 }, // Cast/rolled glass, not wired, coloured/opacified
          { prefix: '7003.12', syntheticRank: 8 }, // Cast/rolled glass, coloured throughout
          { prefix: '7020.00', syntheticRank: 7 }, // Other articles of glass
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '7003' },
          { delta: 0.4, chapterMatch: '70' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW TEMPERED_GLASS_SCREEN_INTENT ──────────────────────────────────
    // "iPhone Air Tempered Glass Screen Protector" → 7007.19 (safety glass, other)
    // "tempered glass screen protector", "glass screen guard" → ch.70
    // Blocked by AI_CH75_NICKEL_MESH_CLOTH ('screen' in anyOf)
    patches.push({
      priority: 573,
      rule: {
        id: 'TEMPERED_GLASS_SCREEN_INTENT',
        description: 'Tempered glass screen protectors for phones/tablets → ch.70 (7007.19). ' +
          '"Tempered glass screen protector", "iPhone glass protector", "screen guard" → 7007.19. ' +
          'Without rule, AI_CH75_NICKEL_MESH_CLOTH blocks ch.70 for screen protector queries.',
        pattern: {
          anyOf: [
            'tempered glass screen', 'screen protector', 'glass protector', 'glass screen protector',
            'phone screen protector', 'iphone glass', 'ipad glass', 'tablet glass',
            'tempered glass protector', 'screen guard', 'glass guard',
            'privacy screen', 'anti glare screen',
          ],
          noneOf: ['mesh', 'wire mesh', 'metal screen', 'window screen', 'door screen'],
        },
        whitelist: { allowChapters: ['70'] },
        inject: [
          { prefix: '7007.19', syntheticRank: 9 }, // Safety glass, other tempered glass
          { prefix: '7007.29', syntheticRank: 8 }, // Laminated safety glass, other
          { prefix: '7020.00', syntheticRank: 7 }, // Other articles of glass
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '7007.19' },
          { delta: 0.4, chapterMatch: '70' },
        ],
      } as IntentRule,
    });

    // ── 6. NEW GLASS_ROD_LAMPWORK_INTENT ─────────────────────────────────────
    // "Creation is Messy Boro Glass Rods" → 7002.20 (glass rods)
    // "lampwork glass rods", "borosilicate rod" → ch.70
    // No rules fire for glass rod/lampwork queries
    patches.push({
      priority: 554,
      rule: {
        id: 'GLASS_ROD_LAMPWORK_INTENT',
        description: 'Glass rods, lampwork glass, and borosilicate rods for crafts → ch.70 (7002.20). ' +
          '"Glass rods", "lampwork glass", "borosilicate rod", "creation is messy" → 7002.20. ' +
          'Without rule, no ch.70 results for glass rod/lampwork craft supply queries.',
        pattern: {
          anyOf: [
            'glass rod', 'glass rods', 'lampwork glass', 'lampworking', 'borosilicate rod',
            'boro glass', 'borosilicate glass', 'glass tube', 'glass tubes',
            'creation is messy', 'soft glass rod', 'hard glass rod',
            'glass bead making', 'flameworking glass',
          ],
          noneOf: ['lipstick', 'chapstick', 'curtain rod', 'shower rod', 'curtain'],
        },
        whitelist: { allowChapters: ['70'] },
        inject: [
          { prefix: '7002.20', syntheticRank: 9 }, // Glass rods, unworked
          { prefix: '7002.10', syntheticRank: 8 }, // Glass balls, unworked
          { prefix: '7020.00', syntheticRank: 7 }, // Other articles of glass
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '7002' },
          { delta: 0.4, chapterMatch: '70' },
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
