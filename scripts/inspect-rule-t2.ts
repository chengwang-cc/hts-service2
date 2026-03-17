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
  const noneOf: string[] = p.noneOf ?? [];
  if (noneOf.some((t: string) => matches(t, tokens, lower))) return false;
  const anyOf: string[] = p.anyOf ?? [];
  const anyOfGroups: string[][] = p.anyOfGroups ?? [];
  const required: string[] = p.required ?? [];
  const hasAnyOf = anyOf.length === 0 || anyOf.some((t: string) => matches(t, tokens, lower));
  const hasGroups = anyOfGroups.length === 0 || anyOfGroups.every((g: string[]) => g.some((t: string) => matches(t, tokens, lower)));
  const hasRequired = required.every((t: string) => matches(t, tokens, lower));
  return hasAnyOf && hasGroups && hasRequired;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });
    const allRules = svc.getAllRules() as any[];
    const blockingRules = allRules.filter(r => r.whitelist?.allowChapters?.length);
    
    const lines = fs.readFileSync(EVAL_PATH, 'utf-8').split('\n');
    const entries: any[] = [];
    for (const line of lines) {
      if (!line.trim() || line.startsWith('#')) continue;
      try { entries.push(JSON.parse(line)); } catch {}
    }

    const targetRules = ['AI_CH31_ORGANIC_ANIMAL_FERTILIZER', 'AI_CH15_VEGETABLE_WAX_BEESWAX', 'AI_CH15_BEESWAX', 'SPICE_INTENT', 'BONE_CHINA_CERAMIC_DISHWARE_INTENT', 'AI_CH69_CERAMIC_MISC_HOUSEHOLD', 'NAIL_RIVET_INTENT', 'AI_CH40_RUBBER_HOSE_PIPE', 'AI_CH14_PLAITING_MATERIALS', 'AI_CH58_RIBBON_TRIM', 'BOARD_GAME_INTENT', 'PET_ACCESSORY_INTENT', 'AI_CH40_RUBBER_GASKET_SEAL', 'SWIMWEAR_INTENT'];
    
    for (const ruleId of targetRules) {
      const rule = allRules.find(r => r.id === ruleId);
      if (rule) {
        console.log(`\n=== ${ruleId} ===`);
        console.log(`anyOf (${(rule.pattern?.anyOf??[]).length}): ${JSON.stringify((rule.pattern?.anyOf??[]).slice(0,8))}`);
        console.log(`noneOf (${(rule.pattern?.noneOf??[]).length}): first5=${JSON.stringify((rule.pattern?.noneOf??[]).slice(0,5))}`);
        console.log(`allowChapters: ${JSON.stringify(rule.whitelist?.allowChapters)}`);
      }
      
      const blocked: string[] = [];
      for (const entry of entries.slice(0, 5000)) {
        if (!entry.endpoints?.includes('autocomplete')) continue;
        const q: string = entry.query;
        const expCh: string = entry.expectedChapter;
        const hts: string = entry.expectedHtsNumber;
        const firing = blockingRules.filter((r: any) => ruleMatches(r, q));
        const allowSet = new Set<string>(firing.flatMap((r: any) => r.whitelist.allowChapters as string[]));
        const expChNorm = expCh.padStart(2, '0');
        const allowSetNorm = new Set([...allowSet].map(c => c.padStart(2, '0')));
        if (allowSetNorm.size > 0 && !allowSetNorm.has(expChNorm)) {
          const isTarget = firing.some(r => r.id === ruleId);
          if (isTarget) {
            const triggerTerms = rule ? (rule.pattern?.anyOf??[]).filter((t: string) => matches(t, tokenize(q), q.toLowerCase())) : [];
            blocked.push(`  [ch.${expCh}] "${q}" → ${hts} | matched: ${JSON.stringify(triggerTerms)}`);
          }
        }
      }
      console.log(`Blocked: ${blocked.length}`);
      blocked.forEach(b => console.log(b));
    }
  } finally {
    await app.close();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
