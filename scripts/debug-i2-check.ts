#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  { q: 'Dried Flower Resin', expCh: '39' },
  { q: 'Silk Flower Fabric', expCh: '52' },
  { q: 'Artificial Flower Pot Ceramic', expCh: '69' },
  { q: 'Paper Flower Kit Craft Supplies', expCh: '48' },
  { q: 'Rose Stem Wedding Centerpiece Wire', expCh: '73' },
  { q: 'Floral Stem Wire Wrapped', expCh: '73' },
];

function tokenize(q: string): Set<string> {
  const stop = new Set(['a','an','the','for','and','with','to','of','in','on','by','or','at','is','it','its','nor','other','than','from','not','as','be','if','no','so','do','up','use']);
  return new Set((q.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t: string) => !stop.has(t) && t.length > 1));
}
function tokenOrPhraseMatches(t: string, tokens: Set<string>, qLower: string): boolean {
  return t.includes(' ') ? qLower.includes(t) : tokens.has(t);
}
function pm(rule: any, q: string): boolean {
  const tokens = tokenize(q); const qLower = q.toLowerCase(); const p = rule.pattern;
  if (!p) return false;
  if (p.required) { for (const r of p.required) { if (!tokenOrPhraseMatches(r, tokens, qLower)) return false; } }
  if (p.noneOf) { for (const n of p.noneOf) { if (tokenOrPhraseMatches(n, tokens, qLower)) return false; } }
  if (p.anyOf && p.anyOf.length > 0) { if (!p.anyOf.some((t: string) => tokenOrPhraseMatches(t, tokens, qLower))) return false; }
  return true;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false }) as any;
  const rules = svc.getAllRules();

  for (const { q, expCh } of QUERIES) {
    const firing = rules.filter((r: any) => pm(r, q));
    const allowChRules = firing.filter((r: any) => r.whitelist?.allowChapters?.length);
    const allowSet = new Set<string>(allowChRules.flatMap((r: any) => r.whitelist.allowChapters as string[]));
    console.log(`\n"${q}" (exp ch.${expCh})`);
    for (const r of allowChRules) console.log(`  ${r.id}: [${r.whitelist.allowChapters.join(',')}]`);
    if (allowSet.size > 0) {
      console.log(`  AllowSet: [${[...allowSet].sort().join(',')}]  ch.${expCh} allowed: ${allowSet.has(expCh)}`);
      if (!allowSet.has(expCh)) console.log('  *** BLOCKED ***');
    } else {
      console.log('  No restrictions');
    }
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
