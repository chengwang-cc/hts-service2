#!/usr/bin/env ts-node
/**
 * Show all entries blocked by the top-N blocking rules
 */
import 'tsconfig-paths/register';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const EVAL_PATH = path.resolve(__dirname, '../docs/evaluation/lookup-evaluation-set-v1.jsonl');
const TARGET_RULES = (process.env.RULES ?? 'AI_CH92_DRUM_STAND_ACCESSORY,AI_CH36_FIREWORKS,AI_CH65_DISPOSABLE_CAP').split(',');
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
  const hasPos = (p.anyOf?.length > 0) || (p.anyOfGroups?.length > 0) || (p.required?.length > 0);
  if (!hasPos) return false;
  return true;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false }) as any;
  const allRules: any[] = svc.getAllRules();
  const blockingRules = allRules.filter(r => r.whitelist?.allowChapters?.length);

  // Print full pattern for target rules
  for (const id of TARGET_RULES) {
    const rule = allRules.find((r: any) => r.id === id);
    if (!rule) { console.log(`${id}: NOT FOUND`); continue; }
    const p = rule.pattern ?? {};
    console.log(`\n=== ${id} ===`);
    console.log(`allowChapters: ${JSON.stringify(rule.whitelist?.allowChapters)}`);
    if (p.anyOf) console.log(`anyOf (${p.anyOf.length}): ${JSON.stringify(p.anyOf)}`);
    if (p.anyOfGroups) console.log(`anyOfGroups: ${JSON.stringify(p.anyOfGroups)}`);
    if (p.required) console.log(`required: ${JSON.stringify(p.required)}`);
    if (p.noneOf) console.log(`noneOf (${p.noneOf.length}): ${JSON.stringify(p.noneOf.slice(0,10))}`);
  }

  const lines = fs.readFileSync(EVAL_PATH, 'utf-8').split('\n');
  const entries: any[] = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    try { entries.push(JSON.parse(line)); } catch {}
  }

  console.log('\n=== BLOCKED ENTRIES BY TARGET RULES ===');
  for (const id of TARGET_RULES) {
    const targetRule = blockingRules.find((r: any) => r.id === id);
    if (!targetRule) { console.log(`\n${id}: NOT FOUND as blocking rule`); continue; }

    console.log(`\n--- ${id} (allows [${targetRule.whitelist.allowChapters.join(',')}]) ---`);
    let count = 0;
    for (const entry of entries) {
      if (!entry.endpoints?.includes('autocomplete')) continue;
      const q: string = entry.query;
      const expCh: string = (entry.expectedChapter ?? '').padStart(2, '0');
      const hts: string = entry.expectedHtsNumber;

      if (!ruleMatches(targetRule, q)) continue; // target rule doesn't fire

      const firing = blockingRules.filter((r: any) => ruleMatches(r, q));
      const allowSet = new Set([...new Set(firing.flatMap((r: any) => r.whitelist.allowChapters as string[]))].map(c => c.padStart(2,'0')));
      if (allowSet.size > 0 && !allowSet.has(expCh)) {
        count++;
        // Find what terms matched the target rule
        const p = targetRule.pattern ?? {};
        const tokens = tokenize(q);
        const lower = q.toLowerCase();
        const matchedTerms: string[] = [];
        if (p.anyOf) for (const t of p.anyOf) if (matches(t, tokens, lower)) matchedTerms.push(t);
        if (p.anyOfGroups) {
          for (let gi = 0; gi < p.anyOfGroups.length; gi++) {
            const group = p.anyOfGroups[gi] as string[];
            const gMatch = group.filter((t: string) => matches(t, tokens, lower));
            if (gMatch.length > 0) matchedTerms.push(`[grp${gi}:${gMatch.join('|')}]`);
          }
        }
        if (count <= 30) {
          console.log(`  [ch.${expCh}] "${q.slice(0,70)}" → ${hts}`);
          console.log(`    matched: ${matchedTerms.join(', ')}`);
        }
      }
    }
    console.log(`  Total blocked: ${count}`);
  }

  await app.close();
}

main().catch(err => { console.error(err); process.exit(1); });
