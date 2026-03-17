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
      'LOUDSPEAKER_AUDIO_ACCESSORY_INTENT',
      'PET_FOOD_INTENT',
      'POLYESTER_FABRIC_INTENT',
      'AI_CH91_MARINE_CHRONOMETER',
      'JIGSAW_PUZZLE_INTENT',
      'BOOKSHELF_INTENT',
      'STETHOSCOPE_INTENT',
      'AI_CH56_NONWOVEN_FABRIC',
      'GRANOLA_CEREAL_INTENT',
      'AI_CH11_OAT_PRODUCTS',
      'NECKTIE_SCARF_FASHION_ACCESSORY_INTENT',
      'AI_CH75_NICKEL_MATTE',
      'DOOR_HARDWARE_KNOCKER_INTENT',
      'TELESCOPE_BINOCULARS_INTENT',
      'JEWELRY_NECKLACE_INTENT',
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
        const triggered = (rule.pattern?.anyOf ?? []).filter((t: string) => matches(t, tokens, lower));
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
