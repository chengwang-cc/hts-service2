#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  { q: 'Whiskey Glasses', expCh: '70' },
  { q: 'White Puppy Glass Cup Kawaii Cat Glass Cup', expCh: '70' },
  { q: 'honeypot', expCh: '70' },
  { q: 'Peach Pink Paper Flower Nursery Wall Decor Gold Accents', expCh: '67' },
  { q: 'Swaddle', expCh: '62' },
  { q: 'kilt', expCh: '62' },
  { q: 'abaya', expCh: '62' },
  { q: 'Hijab', expCh: '62' },
  { q: 'camisole', expCh: '62' },
  { q: 'headscarf', expCh: '62' },
  { q: 'Handwarmer', expCh: '62' },
  { q: 'Armbands', expCh: '62' },
  { q: 'Sheer Black Ankle Socks with Chain Hip Hop Fashion', expCh: '64' },
];

function tokenize(q: string): Set<string> {
  const stop = new Set(['a','an','the','for','and','with','to','of','in','on','by','or','at','is','it','its','nor','other','than','from','not','as','be','if','no','so','do','up','use']);
  return new Set((q.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t: string) => !stop.has(t) && t.length > 1));
}

function tokenOrPhraseMatches(t: string, tokens: Set<string>, qLower: string): boolean {
  return t.includes(' ') ? qLower.includes(t) : tokens.has(t);
}

function patternMatchesLocal(rule: any, q: string): boolean {
  const tokens = tokenize(q);
  const qLower = q.toLowerCase();
  const p = rule.pattern;
  if (!p) return false;
  if (p.required) { for (const r of p.required) { if (!tokenOrPhraseMatches(r, tokens, qLower)) return false; } }
  if (p.noneOf) { for (const n of p.noneOf) { if (tokenOrPhraseMatches(n, tokens, qLower)) return false; } }
  if (p.anyOf && p.anyOf.length > 0) { if (!p.anyOf.some((t: string) => tokenOrPhraseMatches(t, tokens, qLower))) return false; }
  if (p.anyOfGroups) { for (const group of p.anyOfGroups) { if (group.length > 0 && !group.some((t: string) => tokenOrPhraseMatches(t, tokens, qLower))) return false; } }
  return true;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false }) as any;
  const rules = svc.getAllRules();

  for (const { q, expCh } of QUERIES) {
    const firing = rules.filter((r: any) => patternMatchesLocal(r, q));
    const allowChRules = firing.filter((r: any) => r.whitelist?.allowChapters?.length);
    const allowSet = new Set<string>(allowChRules.flatMap((r: any) => r.whitelist.allowChapters as string[]));

    console.log(`\n"${q}" (exp ch.${expCh})`);
    if (allowChRules.length === 0) {
      console.log('  No allowChapters restrictions → open (semantic determines result)');
    } else {
      for (const r of allowChRules) {
        console.log(`  ${r.id}: [${(r.whitelist.allowChapters as string[]).join(',')}]`);
      }
      console.log(`  AllowSet: [${[...allowSet].sort().join(',')}]  ch.${expCh} allowed: ${allowSet.has(expCh)}`);
      if (!allowSet.has(expCh)) console.log('  *** RULE-CAUSED BLOCKED ***');
    }
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
