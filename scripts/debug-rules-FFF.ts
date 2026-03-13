import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  { q: 'Other Beef in airtight containers', expCh: '16', gotCh: '16', expected: '1601.00.40.90', got: '1602.50.07.20' },
  { q: 'Cigarette leaf Tobacco not stemmed/stripped Unmanufactured tobacco whether or not threshed or similarly processed tobacco refuse', expCh: '24', gotCh: '24', expected: '2401.10.44.00', got: '2401.30.23.10' },
  { q: 'Other Used pneumatic tires', expCh: '40', gotCh: '40', expected: '4012.20.45.00', got: '4012.12.80.19' },
];

function tokenize(q: string): Set<string> {
  return new Set(q.toLowerCase().split(/\s+/).map(t => t.replace(/[^a-z0-9]/g, '')).filter(Boolean));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function tokenOrPhraseMatches(t: string, tokens: Set<string>, qLower: string): boolean {
  return t.includes(' ') ? qLower.includes(t) : tokens.has(t);
}
function patternMatches(rule: Any, q: string): boolean {
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

  for (const { q, expCh, gotCh, expected, got } of QUERIES) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`(ch.${expCh}→${gotCh}): "${q.slice(0, 60)}"`);
    console.log(`Expected: ${expected}, Got: ${got}`);

    const firing = rules.filter(r => patternMatches(r, q));
    if (firing.length === 0) { console.log('  No rules fire → pure semantic'); continue; }

    const allowSet = new Set<string>();
    const allowPrefixSet = new Set<string>();
    for (const r of firing) {
      const wl = r.whitelist ?? {};
      if (wl.allowChapters) for (const c of wl.allowChapters) allowSet.add(c);
      if (wl.allowPrefixes) for (const p of wl.allowPrefixes) allowPrefixSet.add(p);
    }

    console.log(`  Firing rules: ${firing.map((r: Any) => r.id).join(', ')}`);
    console.log(`  AllowChapters: [${Array.from(allowSet).sort().join(',')}]`);
    console.log(`  AllowPrefixes: [${Array.from(allowPrefixSet).join(',')}]`);

    for (const r of firing) {
      const wl = r.whitelist as Any ?? {};
      if (wl.allowChapters || wl.allowPrefixes || r.inject) {
        console.log(`    ${r.id}: allow=[${wl.allowChapters?.join(',')}], pfx=[${wl.allowPrefixes?.join(',')}], inject=[${(r.inject ?? []).map((s: Any) => s.prefix+'@'+s.syntheticRank).join(',')}]`);
      }
    }
  }

  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
