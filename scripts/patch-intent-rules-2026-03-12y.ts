#!/usr/bin/env ts-node
/**
 * Patch Y — 2026-03-12:
 *
 * Fix 6 more rules causing ch.93 (firearms/military) and ch.29/87 failures:
 *
 * 1. SCREW_BOLT_INTENT: bare "bolt" fires for "captive-bolt humane killers" in firearm
 *    HTS descriptions → allowChapters:[73] blocks ch.93. Fix: add noneOf for ammunition/
 *    captive/humane context.
 *
 * 2. AI_CH36_SIGNAL_FLARES: "signal flares" fires for "devices designed to project only
 *    signal flares" in firearm HTS descriptions → allowChapters:[36] blocks ch.93.
 *    Fix: add noneOf for firearms/military context.
 *
 * 3. AI_CH36_EXPLOSIVES: "ammunition"/"explosive" fires for "firing of an explosive charge"
 *    / "blank ammunition" in firearm HTS descriptions → allowChapters:[36] blocks ch.93.
 *    Fix: add noneOf=['firearms','firearm','military weapons','pistol','revolvers'].
 *
 * 4. AI_CH66_TELESCOPIC_UMBRELLA: "telescopic" fires for "Telescopic sights imported with
 *    rifles" → allowChapters:[66] blocks ch.93. Fix: add noneOf for sight/scope/firearm
 *    context.
 *
 * 5. AI_CH88_SPACECRAFT: "rocket" fires for "Rocket launchers... Military weapons" →
 *    allowChapters:[88] blocks ch.93. Fix: add noneOf for weapon/launcher/military context.
 *
 * 6. AI_CH31_DEF: "diesel" fires for diesel engines in motor vehicles (ch.87) →
 *    allowChapters:[31] blocks ch.87. DEF (Diesel Exhaust Fluid) uses "diesel" but the
 *    context is always about the additive/fluid, not the engine. Fix: remove "diesel"
 *    from anyOf (too generic) and add noneOf for vehicle/engine context.
 *
 * 7. AI_CH54_RAYON_FABRIC: "acetate" fires for "vinyl acetate" (organic chemical ch.29) →
 *    allowChapters:[54] blocks ch.29. Acetate rayon fabric ≠ vinyl acetate monomer.
 *    Fix: add noneOf=['vinyl','vinyl acetate','ethylene','acetaldehyde','monomer'].
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12y.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const FIREARM_NONE_OF = [
  'firearms', 'firearm', 'pistol', 'revolver', 'revolvers', 'rifle', 'rifles',
  'shotgun', 'shotguns', 'military weapons', 'military weapon', 'carbine',
  'muzzle-loading', 'ammunition', 'blank ammunition', 'captive-bolt', 'captive',
];

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix SCREW_BOLT_INTENT — exclude captive-bolt/ammunition context ────────
  {
    priority: 640,
    rule: {
      id: 'SCREW_BOLT_INTENT',
      description: 'Screws, bolts, nuts, washers → ch.73. ' +
        'Added noneOf for firearms/captive-bolt context: bare "bolt" fires for "captive-bolt ' +
        'humane killers" in firearm HTS descriptions (ch.93).',
      pattern: {
        anyOf: [
          'screws', 'screw', 'wood screw', 'machine screw', 'self-tapping screw',
          'bolts', 'bolt', 'hex bolt', 'carriage bolt',
          'nuts', 'hex nut', 'lock nut', 'wing nut',
          'washers', 'washer', 'flat washer',
        ],
        noneOf: FIREARM_NONE_OF,
      },
      whitelist: { allowChapters: ['73'] },
    },
  },

  // ── 2. Fix AI_CH36_SIGNAL_FLARES — exclude firearms/military context ──────────
  {
    priority: 620,
    rule: {
      id: 'AI_CH36_SIGNAL_FLARES',
      description: 'Signal flares, fog signals, distress signals → ch.36. ' +
        'Added noneOf for firearms/military context: "signal flares" fires for "devices ' +
        'designed to project only signal flares" in firearms HTS descriptions (ch.93). ' +
        'Also keeps prior noneOf for propulsion/engine context (from patch O).',
      pattern: {
        anyOf: [
          'flare', 'flares', 'signal flare', 'fog signal', 'distress signal',
          'rain rocket', 'pyrotechnic', 'smoke signal', 'emergency flare',
        ],
        noneOf: [
          // Propulsion context (from patch O)
          'propulsion', 'engine', 'engines', 'motor', 'thrust', 'turbine', 'piston',
          // Firearms/military context
          ...FIREARM_NONE_OF,
        ],
      },
      whitelist: { allowChapters: ['36'] },
    },
  },

  // ── 3. Fix AI_CH36_EXPLOSIVES — exclude firearms/military context ─────────────
  {
    priority: 620,
    rule: {
      id: 'AI_CH36_EXPLOSIVES',
      description: 'Industrial explosives, blasting, detonators, propellants → ch.36. ' +
        'Added noneOf for firearms/military context: "ammunition" and "explosive" fire for ' +
        '"firing of an explosive charge" / "blank ammunition" in firearms descriptions (ch.93). ' +
        'Military ammunition for firearms is ch.93, not ch.36.',
      pattern: {
        anyOf: [
          'explosives', 'explosive', 'dynamite', 'blasting', 'anfo',
          'detonating', 'detonator', 'detonators', 'propellant', 'gunpowder',
          'powder', 'ammunition',
        ],
        noneOf: FIREARM_NONE_OF,
      },
      whitelist: { allowChapters: ['36'] },
    },
  },

  // ── 4. Fix AI_CH66_TELESCOPIC_UMBRELLA — exclude scope/sight/rifle context ─────
  {
    priority: 630,
    rule: {
      id: 'AI_CH66_TELESCOPIC_UMBRELLA',
      description: 'Telescopic/compact/folding umbrellas, travel umbrellas → ch.66. ' +
        'Added noneOf for optics/sight/firearm context: "telescopic" fires for "Telescopic ' +
        'sights imported with rifles" (ch.93). Telescopic umbrella ≠ rifle telescopic sight.',
      pattern: {
        anyOf: [
          'telescopic', 'collapsible', 'compact', 'folding', 'foldable', 'travel',
        ],
        noneOf: [
          // Firearm/optics context
          'sights', 'sight', 'scope', 'scopes', 'rifle', 'rifles', 'firearm', 'firearms',
          'weapon', 'optic', 'optics', 'binocular', 'binoculars', 'monocular',
          'reticle', 'crosshair', 'aiming',
        ],
      },
      whitelist: { allowChapters: ['66'] },
    },
  },

  // ── 5. Fix AI_CH88_SPACECRAFT — exclude weapon/launcher/military context ───────
  {
    priority: 630,
    rule: {
      id: 'AI_CH88_SPACECRAFT',
      description: 'Satellites, spacecraft, launch vehicles → ch.88. ' +
        'Added noneOf for weapon/launcher/military context: "rocket" fires for "Rocket ' +
        'launchers... Military weapons" in ch.93 HTS descriptions. ' +
        'Spacecraft rockets ≠ rocket-propelled weapons.',
      pattern: {
        anyOf: [
          'satellite', 'satellites', 'spacecraft', 'rocket', 'launch', 'orbital', 'suborbital',
        ],
        noneOf: [
          // Weapon/military context
          'launcher', 'launchers', 'military', 'weapon', 'weapons', 'warhead', 'warheads',
          'grenade', 'torpedo', 'torpedoes', 'flame-thrower', 'flame thrower',
          'projector', 'projectors', 'thrower',
        ],
      },
      whitelist: { allowChapters: ['88'] },
    },
  },

  // ── 6. Fix AI_CH31_DEF — remove "diesel" (too generic) ───────────────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH31_DEF',
      description: 'Diesel Exhaust Fluid (DEF), AdBlue, SCR fluid → ch.31. ' +
        'Removed "diesel" from anyOf: fires for "diesel or semi-diesel" in motor vehicle ' +
        'HTS descriptions (ch.87), blocking the correct chapter. ' +
        '"def","adblue","exhaust","scr" are sufficient to identify DEF products.',
      pattern: {
        anyOf: [
          'def',
          'adblue',
          // "diesel" removed — too generic (fires for diesel engines in vehicles)
          'diesel exhaust fluid',  // use phrase instead
          'scr',
          'urea solution',
        ],
        noneOf: [
          // Vehicle/engine context
          'engine', 'engines', 'vehicle', 'vehicles', 'motor', 'propulsion',
          'piston', 'cylinder', 'crankshaft',
        ],
      },
      whitelist: { allowChapters: ['31'] },
    },
  },

  // ── 7. Fix AI_CH54_RAYON_FABRIC — exclude vinyl acetate context ──────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH54_RAYON_FABRIC',
      description: 'Rayon, viscose, lyocell, acetate fabric → ch.54. ' +
        'Added noneOf for vinyl acetate context: "acetate" fires for "vinyl acetate" ' +
        '(organic chemical monomer, ch.29). Acetate rayon fabric ≠ vinyl acetate monomer.',
      pattern: {
        anyOf: [
          'rayon', 'viscose', 'cuprammonium', 'lyocell', 'tencel', 'acetate',
        ],
        noneOf: [
          // Vinyl/organic chemistry context → ch.29
          'vinyl', 'vinyl acetate', 'ethylene', 'acetaldehyde', 'monomer',
          'polymerization', 'ester', 'acetic acid',
        ],
      },
      whitelist: { allowChapters: ['54'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch Y)...`);

    let success = 0;
    let failed = 0;

    for (const { rule, priority } of PATCHES) {
      try {
        await svc.upsertRule(rule, priority, true);
        console.log(`  ✅ ${rule.id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${rule.id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch Y complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

patch().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
