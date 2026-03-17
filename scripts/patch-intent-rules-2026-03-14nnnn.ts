#!/usr/bin/env ts-node
/**
 * Patch NNNN — 2026-03-14:
 *
 * 1. COMIC_INTENT: add 'flat sheet','bed sheet','bedding','pillow','duvet' to noneOf
 *    'comics' fires COMIC_INTENT.denyNonAllowedUnlessEntryHasTokens → blocks ALL non-ch.49 entries
 *    including 6302.22 injected bed linen for "DC Comics Batman Twin Flat Sheet"
 *
 * 2. CLOCK_TIMEPIECE_INTENT: add boosts + fix inject to use prefixes with 10-digit leaves
 *    9102.11 only has 8-digit entries → inject fails; score without boosts = 0.137 < 0.25 threshold
 *
 * 3. NEW DOOR_HARDWARE_KNOCKER_INTENT (ch.83): door knocker/door hardware → 8302.10
 *    "metal Horse Head Door Knocker" → semantic returns ch.01 horse livestock; no allow-rules → wrong ch
 *
 * 4. NEW HDMI_VIDEO_PROCESSOR_INTENT (ch.85): hdmi/video processor → 8521.90
 *    "used digital video switch processor HDMI" → semantic returns ch.86 railway signals; no allow-rules
 *
 * 5. NEW WIG_GRIP_HEADWEAR_INTENT (ch.61): wig grip band/silicone headband → 6117.80
 *    "Silicone Non-Slip Wig Grip Band" → semantic returns ch.93 firearms grip; no allow-rules
 *
 * 6. NEW FAUX_FUR_PILE_FABRIC_INTENT (ch.60): faux fur/pile fabric → 6001.92
 *    "Faux Fur Keychain Tail Accessory" → semantic returns ch.73 metalware; no allow-rules
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14nnnn.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed NNNN: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. COMIC_INTENT: add bedding context to noneOf ────────────────────────
    // denyNonAllowedUnlessEntryHasTokens → allowedChapters: ["49"]
    // When "comics" fires COMIC_INTENT, ALL non-ch.49 entries without comic vocab are denied
    // This blocks injected 6302.22 bed linen for "DC Comics Batman Twin Flat Sheet"
    addNoneOf('COMIC_INTENT', [
      'flat sheet', 'fitted sheet', 'bed sheet', 'sheet set', 'bedding set',
      'bedding', 'pillow', 'pillowcase', 'duvet', 'comforter', 'quilt',
      'blanket', 'twin sheet', 'queen sheet', 'king sheet',
    ], 'bedding context prevents comic intent from denying non-ch.49 entries when query is about comic-themed bedding');

    // ── 2. CLOCK_TIMEPIECE_INTENT: add boosts + fix inject prefixes ───────────
    // Without boosts, injected ch.91 score = 0.017 + 0.12 = 0.137 < 0.25 threshold
    // Also 9102.11 has only 8-digit leaves (inject ignores them); use 9102.12 which has 10-digit
    {
      const existing = allRules.find(r => r.id === 'CLOCK_TIMEPIECE_INTENT') as IntentRule | undefined;
      if (existing) {
        const currentInject: any[] = (existing as any).inject ?? [];
        // Keep current inject but also add prefixes with verified 10-digit leaves
        // Use 9102.12 (has 9102.12.80.00), 9105.19 (has 9105.19.40.00)
        const currentPrefixes = new Set(currentInject.map((i: any) => i.prefix));
        const toAdd = [
          { prefix: '9102.12', syntheticRank: 9 },  // Electrically operated watches
          { prefix: '9105.19', syntheticRank: 8 },  // Other electric clocks
          { prefix: '9101.19', syntheticRank: 7 },  // Other watches with precious metal case
          { prefix: '9102.29', syntheticRank: 6 },  // Other watches
        ].filter(i => !currentPrefixes.has(i.prefix));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'CLOCK_TIMEPIECE_INTENT') + ' — Fixed NNNN: add boosts + verified inject prefixes',
            inject: [...currentInject, ...toAdd],
            boosts: [
              { delta: 0.5, chapterMatch: '91' },   // Strong boost for any ch.91 entry
              { delta: 0.3, prefixMatch: '9102' },  // Boost watches
              { delta: 0.3, prefixMatch: '9105' },  // Boost clocks
            ],
          } as IntentRule,
        });
        console.log(`CLOCK_TIMEPIECE_INTENT: adding boosts + ${toAdd.length} inject prefixes`);
      } else {
        console.log('WARNING: CLOCK_TIMEPIECE_INTENT not found');
      }
    }

    // ── 3. NEW DOOR_HARDWARE_KNOCKER_INTENT ──────────────────────────────────
    // "metal Horse Head Door Knocker" → 8302.10 (ch.83)
    // Semantic returns ch.01 horse livestock; no allow-rules to fix chapter
    patches.push({
      priority: 557,
      rule: {
        id: 'DOOR_HARDWARE_KNOCKER_INTENT',
        description: 'Door knockers and architectural hardware → ch.83 (8302.10). ' +
          '"door knocker", "door handle", "door hinge" → 8302.10. ' +
          'Without rule, semantic returns wrong chapters for horse/animal-themed door knockers.',
        pattern: {
          anyOf: [
            'door knocker', 'door knockers', 'knocker', 'door hardware',
            'door handle', 'door handles', 'door hinge', 'door hinges',
            'door pull', 'cabinet hardware', 'drawer pull', 'drawer knob',
            'cabinet knob', 'door hook', 'door stop',
          ],
          noneOf: ['software', 'digital'],
        },
        whitelist: { allowChapters: ['83', '73', '76'] },
        inject: [
          { prefix: '8302.10', syntheticRank: 9 }, // Hinges
          { prefix: '8302.42', syntheticRank: 8 }, // Door/window fittings
          { prefix: '8302.50', syntheticRank: 7 }, // Hat/coat pegs, brackets
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8302' },
          { delta: 0.4, chapterMatch: '83' },
        ],
      } as IntentRule,
    });

    // ── 4. NEW HDMI_VIDEO_PROCESSOR_INTENT ───────────────────────────────────
    // "used digital video switch processor with HDMI input/output" → 8521.90 (ch.85)
    // Semantic returns ch.86 8608 (railway signaling equipment)
    patches.push({
      priority: 575,
      rule: {
        id: 'HDMI_VIDEO_PROCESSOR_INTENT',
        description: 'HDMI switches, video processors and AV matrix switches → ch.85 (8521.90). ' +
          '"HDMI switch", "video processor", "HDMI matrix", "AV switch" → 8521.90. ' +
          'Without rule, semantic returns ch.86 railway signals for "switch processor".',
        pattern: {
          anyOf: [
            'hdmi', 'hdmi switch', 'hdmi matrix', 'video processor', 'hdmi processor',
            'av switch', 'av matrix', 'video switch', 'digital video switch',
            'hdmi splitter', 'hdmi extender', 'video encoder', 'video decoder',
            'capture card', 'scaler', 'hdmi scaler',
          ],
          noneOf: ['cable', 'hdmi cable', 'hdmi cord'],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8521.90', syntheticRank: 9 }, // Other video recording/reproducing apparatus
          { prefix: '8528.72', syntheticRank: 8 }, // TV reception apparatus
          { prefix: '8537.10', syntheticRank: 7 }, // Boards, panels for ≤1000V
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8521.90' },
          { delta: 0.4, chapterMatch: '85' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW WIG_GRIP_HEADWEAR_INTENT ──────────────────────────────────────
    // "Silicone Non-Slip Wig Grip Band Brown" → 6117.80 (ch.61)
    // Semantic returns ch.93 firearms grip accessories
    patches.push({
      priority: 553,
      rule: {
        id: 'WIG_GRIP_HEADWEAR_INTENT',
        description: 'Wig grip bands, headbands, and hair accessories → ch.61 (6117.80). ' +
          '"Wig grip band", "silicone headband", "non-slip headband" → 6117.80. ' +
          'Without rule, semantic returns ch.93 firearms for "grip band".',
        pattern: {
          anyOf: [
            'wig grip', 'wig grip band', 'non-slip wig', 'wig band',
            'silicone headband', 'non-slip headband', 'velvet headband',
            'headband', 'hair band', 'hair wrap', 'turban headband',
            'sports headband', 'sweatband',
          ],
          noneOf: ['hardware', 'metal', 'gun', 'firearm', 'pistol'],
        },
        whitelist: { allowChapters: ['61', '62', '65'] },
        inject: [
          { prefix: '6117.80', syntheticRank: 9 }, // Other accessories for clothing
          { prefix: '6117.10', syntheticRank: 8 }, // Shawls, scarves
          { prefix: '6217.10', syntheticRank: 7 }, // Accessories (not knit)
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '6117.80' },
          { delta: 0.4, chapterMatch: '61' },
        ],
      } as IntentRule,
    });

    // ── 6. NEW FAUX_FUR_PILE_FABRIC_INTENT ───────────────────────────────────
    // "Faux Fur Keychain Tail Accessory" → 6001.92 (ch.60)
    // Semantic returns ch.73 metalware for "keychain"
    patches.push({
      priority: 550,
      rule: {
        id: 'FAUX_FUR_PILE_FABRIC_INTENT',
        description: 'Faux fur, pile fabric accessories and textile tails → ch.60 (6001.92). ' +
          '"Faux fur keychain", "faux fur tail", "plush tail" → 6001.92. ' +
          'Without rule, semantic returns ch.73 metalware for keychain queries.',
        pattern: {
          anyOf: [
            'faux fur', 'fake fur', 'plush tail', 'fur tail', 'fluffy tail',
            'fur keychain', 'pom pom', 'pompom', 'faux fur keychain',
            'fur accessory', 'cosplay tail', 'costume tail',
          ],
          noneOf: ['real fur', 'genuine fur', 'mink', 'fox fur', 'rabbit fur'],
        },
        whitelist: { allowChapters: ['60', '39', '95'] },
        inject: [
          { prefix: '6001.92', syntheticRank: 9 }, // Pile fabrics of man-made fibers
          { prefix: '6001.22', syntheticRank: 8 }, // Pile fabrics of cotton
          { prefix: '3926.40', syntheticRank: 7 }, // Plastic statuettes/articles
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '6001.92' },
          { delta: 0.4, chapterMatch: '60' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch NNNN)...`);
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
    console.log(`\nPatch NNNN complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
