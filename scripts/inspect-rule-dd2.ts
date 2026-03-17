#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const EVAL_PATH = path.resolve(__dirname, '../docs/evaluation/lookup-evaluation-set-v1.jsonl');
const STOP = new Set(['a','an','the','for','and','with','to','of','in','on','by','or','at','is','it','its','nor','other','than','from','not','as','be','if','no','so','do','up','use']);

function tokenize(q: string): Set<string> {
  return new Set((q.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => !STOP.has(t) && t.length > 1));
}
function matches(term: string, tokens: Set<string>, lower: string): boolean {
  return term.includes(' ') ? lower.includes(term) : tokens.has(term);
}
function ruleMatches(rule: any, q: string): boolean {
  const p = rule.pattern ?? {};
  const tokens = tokenize(q);
  const lower = q.toLowerCase();
  if (p.required) for (const r of p.required) if (!matches(r, tokens, lower)) return false;
  if (p.noneOf) for (const n of p.noneOf) if (matches(n, tokens, lower)) return false;
  if (p.anyOf?.length) if (!p.anyOf.some((t: string) => matches(t, tokens, lower))) return false;
  if (p.anyOfGroups) {
    for (const group of p.anyOfGroups as string[][]) {
      if (!group.some((t: string) => matches(t, tokens, lower))) return false;
    }
  }
  const hasPositiveCondition = (p.anyOf?.length > 0) || (p.anyOfGroups?.length > 0) || (p.required?.length > 0);
  if (!hasPositiveCondition) return false;
  return true;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });
    const allRules = svc.getAllRules() as any[];
    const lines = fs.readFileSync(EVAL_PATH, 'utf-8').split('\n');
    const entries: any[] = [];
    for (const line of lines) {
      if (!line.trim() || line.startsWith('#')) continue;
      try { entries.push(JSON.parse(line)); } catch {}
    }
    const autocompleteEntries = entries.filter(e => e.endpoints?.includes('autocomplete'));

    const targetRules = [
      'AI_CH40_ORINGS_GASKETS_SEALS',
      'LAPEL_PIN_BROOCH_INTENT',
      'AI_CH92_DRUM_STAND_ACCESSORY',
      'AI_CH89_ROWBOAT_PADDLEBOAT',
      'TEXTILE_LOOM_MACHINE_INTENT',
      'AI_CH47_RECOVERED_PAPER',
      'AI_CH54_FILAMENT_YARN_RETAIL',
      'AI_CH11_SEMOLINA_GROATS',
      'GEMSTONE_CRYSTAL_MINERAL_INTENT',
      'AI_CH66_TELESCOPIC_UMBRELLA',
      'TRAVEL_MUG_INTENT',
      'SKINCARE_MOISTURIZER_INTENT',
      'AI_CH17_GLUCOSE_SYRUP',
      'BLOOD_GLUCOSE_MONITOR_INTENT',
      'AI_CH89_BUOY_BEACON',
      'AI_CH09_VANILLA',
      'AI_CH18_COCOA_BUTTER',
      'JAM_PRESERVE_INTENT',
      'PRESERVED_FOOD_CH20_INTENT',
      'WAX_MELT_INTENT',
      'AI_CH35_ENZYMES',
      'RESIN_EPOXY_LIQUID_POLYMER_INTENT',
      'AI_CH03_LIVE_FISH',
      'MEAT_BEEF_INTENT',
      'NAIL_POLISH_COSMETIC_INTENT',
      'CIRCULAR_SAW_INTENT',
      'SNEAKER_ATHLETIC_FOOTWEAR_INTENT',
      'EYE_COSMETIC_INTENT',
      'AI_CH17_MAPLE_SUGAR_SYRUP',
      'SPORTS_JERSEY_INTENT',
      'SPORTS_JERSEY_GARMENT_INTENT',
      'FANNY_PACK_INTENT',
      'AI_CH59_TIRE_CORD_FABRIC',
      'AI_CH64_MOLDED_PLASTIC_SANDALS',
      'PEN_PENCIL_INTENT',
      'DENTAL_ORAL_INSTRUMENT_INTENT',
      'AI_CH91_WATCH_PARTS_DIAL',
      'KNEE_BRACE_SUPPORT_INTENT',
      'SASHIKO_STENCIL_DRAWING_INTENT',
    ];

    for (const ruleId of targetRules) {
      const rule = allRules.find(r => r.id === ruleId);
      if (!rule) { console.log(`\n=== ${ruleId} NOT FOUND ===`); continue; }
      console.log(`\n=== ${ruleId} ===`);
      console.log(`anyOf (${(rule.pattern?.anyOf??[]).length}): ${JSON.stringify((rule.pattern?.anyOf??[]).slice(0,8))}`);
      console.log(`noneOf (${(rule.pattern?.noneOf??[]).length}): first5=${JSON.stringify((rule.pattern?.noneOf??[]).slice(0,5))}`);
      console.log(`allowChapters: ${JSON.stringify(rule.whitelist?.allowChapters)}`);

      const blocked: string[] = [];
      for (const entry of autocompleteEntries) {
        const q: string = entry.query ?? '';
        const expCh: string = entry.expectedChapter ?? '';
        const hts: string = entry.expectedHtsNumber ?? '';
        const expChNorm = expCh.padStart(2, '0');
        const allowedChs: string[] = (rule.whitelist?.allowChapters ?? []).map((c: string) => c.padStart(2, '0'));
        if (allowedChs.includes(expChNorm)) continue;
        if (!ruleMatches(rule, q)) continue;
        const tokens = tokenize(q);
        const lower = q.toLowerCase();
        const triggered = [
          ...(rule.pattern?.anyOf ?? []).filter((t: string) => matches(t, tokens, lower)),
          ...(rule.pattern?.required ?? []).filter((t: string) => matches(t, tokens, lower)),
        ];
        blocked.push(`  [ch.${expChNorm}] "${q}" → ${hts}\n    trigger: ${JSON.stringify(triggered)}`);
      }
      console.log(`Blocked: ${blocked.length}`);
      blocked.forEach(b => console.log(b));
    }
  } finally {
    await app.close();
  }
}

main().catch(console.error);
