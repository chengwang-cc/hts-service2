import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  { q: 'Other Shelled Other nuts fresh or dried whether or not shelled or peeled', expCh: '08' },
  { q: 'Other Containing added flavoring or coloring matter Cane or beet sugar and chemically pure sucrose in solid form', expCh: '17' },
];

function tokenize(q: string): Set<string> {
  return new Set(q.toLowerCase().split(/\s+/).map(t => t.replace(/[^a-z0-9]/g, '')).filter(Boolean));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRule = any;

function tokenOrPhraseMatches(t: string, tokens: Set<string>, qLower: string): boolean {
  return t.includes(' ') ? qLower.includes(t) : tokens.has(t);
}

function patternMatches(rule: AnyRule, q: string): boolean {
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
  const svc = app.get(IntentRuleService, { strict: false });
  const rules = svc.getAllRules();

  for (const { q, expCh } of QUERIES) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`QUERY: "${q}"`);
    console.log(`Expected ch.${expCh}`);

    const firing = rules.filter(r => patternMatches(r, q));
    if (firing.length === 0) { console.log('  No rules fire'); continue; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allowSet = new Set<any>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const denySet = new Set<any>();
    for (const r of firing) {
      const wl = r.whitelist ?? {};
      if (wl.allowChapters) for (const c of wl.allowChapters) allowSet.add(c);
      if (wl.denyChapters) for (const c of wl.denyChapters) denySet.add(c);
    }
    const originalAllow = new Set(allowSet);
    for (const d of denySet) allowSet.delete(d);

    console.log(`  Firing rules (${firing.length}):`);
    for (const r of firing) {
      const wl = r.whitelist as AnyRule ?? {};
      console.log(`    ${r.id}: allow=${JSON.stringify(wl.allowChapters ?? [])}, deny=${JSON.stringify(wl.denyChapters ?? [])}`);
    }
    console.log(`  AllowSet before deny: [${Array.from(originalAllow).sort().join(',')}]`);
    console.log(`  DenySet: [${Array.from(denySet).sort().join(',')}]`);
    console.log(`  Effective allowSet: [${Array.from(allowSet).sort().join(',')}]`);
    console.log(`  ch.${expCh} allowed: ${allowSet.size === 0 || allowSet.has(expCh)}`);
    if (allowSet.size === 0) console.log('  *** NO RESTRICTION → semantic fallback');
    else if (allowSet.size > 0 && !allowSet.has(expCh)) console.log('  *** EMPTY RESULT — expected chapter not in allowSet!');
  }

  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
