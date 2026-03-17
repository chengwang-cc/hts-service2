#!/usr/bin/env ts-node
/**
 * Patch KKKK — 2026-03-14:
 *
 * 1. AI_CH67_WIGS_HAIRPIECES: add motorcycle/honda/hazard/webpower/network to noneOf
 *    'switch'/'switches' fires → blocks ch.85 for "Motorcycle Switch", "Honda Hazard Switch", "WEBPOWER PRO SWITCHES"
 *
 * 2. AI_CH19_WAFFLE_WAFER: add optical/panoramic/camera/bellows to noneOf
 *    'cone' fires → blocks ch.90 for "custom made CCB 617C cone" (camera/panoramic cone)
 *
 * 3. CAMERA_PARTS_ACCESSORIES_INTENT: add more anyOf terms
 *    'dslr pcb' phrase doesn't match "dslr MAIN pcb" → CANON DSLR PCB queries miss
 *
 * 4. AI_CH56_METALLIC_YARN: add polyester/crochet/craft/korean to noneOf
 *    'metallic'+'yarn' fires → blocks ch.55 for "shiny metallic polyester korean yarn crochet"
 *
 * 5. NEW ELECTRICAL_AUTOMOTIVE_SWITCH_INTENT (ch.85): hazard switch, motorcycle switch → 8536.50
 *
 * 6. NEW VINTAGE_GAME_JOYSTICK_INTENT (ch.84/85): coleco/atari/joystick → 8471.60
 *
 * 7. NEW SASHIKO_EMBROIDERY_STENCIL_INTENT (ch.90): sashiko stencil/template → 9017.20
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14kkkk.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed KKKK: ${note}`,
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
          description: (existing.description ?? ruleId) + ` — Fixed KKKK: ${note}`,
          pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} anyOf terms`);
    }

    // ── 1. AI_CH67_WIGS_HAIRPIECES: add automotive/electrical switch context ───────
    // 'switch'/'switches' in anyOf fires for automotive/industrial switches
    // "WEBPOWER PRO SWITCHES" → no automotive terms in my existing noneOf
    // "2001 Honda CRV RD1 Hazard Switch" → 'honda', 'hazard', 'crv' not covered
    // "Motorcycle Switch" → 'motorcycle' not covered
    addNoneOf('AI_CH67_WIGS_HAIRPIECES', [
      'motorcycle', 'motorbike', 'bike switch', 'honda', 'toyota', 'ford', 'chevrolet',
      'hazard', 'hazard switch', 'crv', 'rd1', 'indicator switch', 'turn signal',
      'webpower', 'network switch', 'power switch', 'industrial switch', 'circuit',
      'relay', 'fuse', 'breaker', 'circuit breaker', 'isolator',
      'pro switches', 'pro switch',
    ], 'motorcycle/honda/hazard/webpower/network context prevents wig rule from blocking ch.85 switches');

    // ── 2. AI_CH19_WAFFLE_WAFER: add optical/camera/panoramic to noneOf ────────────
    // 'cone' fires for "CCB 617C cone" (camera/bellows cone) → ch.19 blocks ch.90
    // CCB 617C is a Cambo Wide 617 panoramic camera — "cone" = lens cone/bellows
    addNoneOf('AI_CH19_WAFFLE_WAFER', [
      'optical', 'panoramic', 'camera', 'lens', 'bellows',
      'photographic', 'wide angle', 'ccb', 'medium format',
      'film', '617', 'format', 'adaptor',
    ], 'optical/camera/panoramic context prevents waffle-wafer rule blocking camera cones in ch.90');

    // ── 3. CAMERA_PARTS_ACCESSORIES_INTENT: add more anyOf terms for DSLR PCB ──────
    // "CUSED CANON DSLR EOS MAIN PCB ASSY ORIGINAL PART" has 'dslr' and 'pcb' separately
    // 'dslr pcb' as a phrase doesn't match 'dslr MAIN pcb'; need single token 'dslr'
    addToAnyOf('CAMERA_PARTS_ACCESSORIES_INTENT', [
      'dslr', 'pcb assy', 'pcb assembly', 'main pcb', 'eos main', 'canon dslr',
      'mirrorless', 'ccb', 'pentax', 'nikon', 'fujifilm', 'medium format camera',
      'rangefinder', 'hasselblad', 'mamiya', 'rollei',
    ], 'added dslr/pcb-assy/ccb to catch DSLR PCB and camera format queries');

    // ── 4. AI_CH56_METALLIC_YARN: add polyester/crochet to noneOf ────────────────
    // 'metallic'+'yarn' fires for "shiny metallic polyester korean yarn crochet bags"
    // Expected ch.55 (5511.10 synthetic staple fiber yarn); polyester crochet yarn ≠ ch.56 metallic
    addNoneOf('AI_CH56_METALLIC_YARN', [
      'polyester', 'polyester yarn', 'crochet', 'crochet yarn', 'knitting yarn',
      'craft yarn', 'korean', 'korean yarn', 'amigurumi', 'handmade',
    ], 'polyester/crochet/korean context prevents metallic-yarn rule blocking synthetic staple fiber yarns in ch.55');

    // ── 5. NEW ELECTRICAL_AUTOMOTIVE_SWITCH_INTENT ────────────────────────────────
    // "WEBPOWER PRO SWITCHES" → 8536.50.40.00 (electrical switches ≤1000V)
    // "2001 Honda CRV RD1 Hazard Switch" → 8536.50.70.00
    // "Motorcycle Switch" → 8536.50.90.32
    // "Heted Seat Switch" → 8516.80.40.00 (electrical heating appliances)
    patches.push({
      priority: 577,
      rule: {
        id: 'ELECTRICAL_AUTOMOTIVE_SWITCH_INTENT',
        description: 'Electrical/automotive switches → ch.85 (8536.50). ' +
          '"Hazard switch", "Motorcycle switch", "Pro switches", "heated seat switch" → 8536.50. ' +
          'Without rule, AI_CH67 wig rule or ch.86 rank higher for switch queries.',
        pattern: {
          anyOf: [
            'hazard switch', 'hazard flasher', 'turn signal switch', 'indicator switch',
            'motorcycle switch', 'automotive switch', 'vehicle switch',
            'webpower', 'pro switch', 'pro switches', 'industrial switch',
            'network switch', 'managed switch', 'power switch', 'rocker switch',
            'toggle switch', 'push button switch', 'momentary switch',
            'seat heater switch', 'heated seat switch', 'seat switch',
            'dimmer switch', 'light dimmer', 'relay switch',
          ],
          noneOf: ['hair', 'wig', 'weave', 'braid'],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8536.50', syntheticRank: 9 }, // Switches ≤1000V
          { prefix: '8536.41', syntheticRank: 8 }, // Relays ≤60V
          { prefix: '8516.80', syntheticRank: 7 }, // Other electric heating appliances
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8536.50' },
          { delta: 0.4, chapterMatch: '85' },
        ],
      } as IntentRule,
    });

    // ── 6. NEW VINTAGE_GAME_JOYSTICK_INTENT ──────────────────────────────────────
    // "Vintage Coleco Gemini Joysticks for Atari 2600" → 8471.60 (input units)
    // No rules fire → fused.size=0 → EMPTY
    patches.push({
      priority: 548,
      rule: {
        id: 'VINTAGE_GAME_JOYSTICK_INTENT',
        description: 'Vintage/retro game joysticks and controllers → ch.84 (8471.60). ' +
          '"Coleco joystick", "Atari joystick", "vintage game controller" → 8471.60. ' +
          'Without rule, no results found for vintage gaming controller queries.',
        pattern: {
          anyOf: [
            'joystick', 'joysticks', 'game controller', 'gamepad', 'game pad',
            'atari joystick', 'coleco', 'atari 2600', 'commodore joystick',
            'retro joystick', 'retro controller', 'vintage joystick',
            'arcade stick', 'flight stick', 'flightstick',
            'joypad', 'thumbstick',
          ],
          noneOf: ['software', 'subscription', 'digital', 'virtual', 'mobile game'],
        },
        whitelist: { allowChapters: ['84', '85', '95'] },
        inject: [
          { prefix: '8471.60', syntheticRank: 9 }, // Input/output units for computers
          { prefix: '8471.49', syntheticRank: 8 }, // Other computing units
          { prefix: '9504.50', syntheticRank: 7 }, // Video game consoles/machines
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8471.60' },
          { delta: 0.4, chapterMatch: '84' },
        ],
      } as IntentRule,
    });

    // ── 7. NEW SASHIKO_EMBROIDERY_STENCIL_INTENT ─────────────────────────────────
    // "Set 10x Plastic Sashiko Stencil 5x5 + 4x Olympus Sashiko Threads" → 9017.20 (ch.90)
    // Also: drawing tools, stencils → ch.90 (9017.20 = drawing/marking instruments)
    patches.push({
      priority: 549,
      rule: {
        id: 'SASHIKO_STENCIL_DRAWING_INTENT',
        description: 'Embroidery/sewing stencils and drawing templates → ch.90 (9017.20). ' +
          '"Sashiko stencil", "embroidery stencil", "quilting stencil" → 9017.20 (drawing instruments). ' +
          'Without rule, textile/ch.55 ranks higher.',
        pattern: {
          anyOf: [
            'sashiko stencil', 'embroidery stencil', 'quilting stencil',
            'sewing stencil', 'craft stencil', 'quilting template',
            'sashiko template', 'marking template', 'embroidery template',
            'plastic stencil', 'sashiko',
          ],
        },
        whitelist: { allowChapters: ['90', '39'] },
        inject: [
          { prefix: '9017.20', syntheticRank: 9 }, // Drawing/marking instruments
          { prefix: '9017.80', syntheticRank: 8 }, // Other instruments for measuring
          { prefix: '3926.10', syntheticRank: 7 }, // Office/school articles of plastic
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '9017.20' },
          { delta: 0.4, chapterMatch: '90' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch KKKK)...`);
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
    console.log(`\nPatch KKKK complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
