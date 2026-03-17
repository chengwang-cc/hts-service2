#!/usr/bin/env ts-node
/**
 * Quick rule-block diagnostic for v1.jsonl entries.
 * Shows which queries are BLOCKED by allowChapters rules.
 * Does NOT call the API - just simulates rule matching.
 */
import 'tsconfig-paths/register';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const EVAL_PATH = path.resolve(__dirname, '../docs/evaluation/lookup-evaluation-set-v1.jsonl');
const LIMIT = parseInt(process.env.LIMIT ?? '2000', 10);

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
  // If no anyOf, anyOfGroups, or required → rule fires for everything
  // Only return true if at least one positive condition was checked
  const hasPositiveCondition = (p.anyOf?.length > 0) || (p.anyOfGroups?.length > 0) || (p.required?.length > 0);
  if (!hasPositiveCondition) return false; // No trigger conditions = don't fire
  return true;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false }) as any;
  const allRules: any[] = svc.getAllRules();
  const blockingRules = allRules.filter(r => r.whitelist?.allowChapters?.length);

  const lines = fs.readFileSync(EVAL_PATH, 'utf-8').split('\n');
  const entries: any[] = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    try { entries.push(JSON.parse(line)); } catch {}
  }

  let total = 0, blocked = 0;
  const blockedEntries: Array<{ q: string, expCh: string, hts: string, by: string[] }> = [];

  for (const entry of entries.slice(0, LIMIT)) {
    if (!entry.endpoints?.includes('autocomplete')) continue;
    const q: string = entry.query;
    const expCh: string = entry.expectedChapter;
    const hts: string = entry.expectedHtsNumber;
    total++;

    const firing = blockingRules.filter((r: any) => ruleMatches(r, q));
    const allowSet = new Set<string>(firing.flatMap((r: any) => r.whitelist.allowChapters as string[]));
    // Normalize chapter for comparison (allow both "9" and "09")
    const expChNorm = expCh.padStart(2, '0');
    const allowSetNorm = new Set([...allowSet].map(c => c.padStart(2, '0')));
    if (allowSetNorm.size > 0 && !allowSetNorm.has(expChNorm)) {
      blocked++;
      blockedEntries.push({ q, expCh, hts, by: firing.map((r: any) => r.id) });
    }
  }

  console.log(`\nChecked ${total} entries (LIMIT=${LIMIT})`);
  console.log(`Rule-BLOCKED: ${blocked}/${total} = ${((blocked/total)*100).toFixed(2)}%`);

  // Group by blocking rule
  const byRule: Record<string, number> = {};
  for (const e of blockedEntries) {
    for (const r of e.by) byRule[r] = (byRule[r] ?? 0) + 1;
  }
  console.log('\nTop blocking rules:');
  Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([id, cnt]) => {
    const rule = allRules.find(r => r.id === id);
    const chs = rule?.whitelist?.allowChapters?.join(',') ?? '?';
    console.log(`  ${id}: ${cnt} blocks (allows only [${chs}])`);
  });

  console.log('\nFirst 30 blocked entries:');
  for (const e of blockedEntries.slice(0, 30)) {
    console.log(`  [ch.${e.expCh}] "${e.q}" → ${e.hts}`);
    console.log(`    Blocked by: ${e.by.slice(0,3).join(', ')}`);
  }

  await app.close();
}

main().catch(err => { console.error(err); process.exit(1); });
