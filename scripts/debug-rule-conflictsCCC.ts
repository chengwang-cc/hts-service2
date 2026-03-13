import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  { q: 'Other Of a thickness of less than 0.5 mm', expCh: '72', gotCh: '74' },
  { q: 'Exceeding 2.2 kW but not exceeding 7.5 kW Other Other', expCh: '84', gotCh: '85' },
  { q: 'Other Other Other crustaceans', expCh: '16', gotCh: '03' },
  { q: 'Carrot', expCh: '12', gotCh: '07' },
  { q: 'Tomato', expCh: '12', gotCh: '07' },
  { q: 'Other Other In shell', expCh: '12', gotCh: '93' },
  { q: 'Men s or boys Other Of other textile materials', expCh: '61', gotCh: '62' },
  { q: 'Shirts Of artificial fibers', expCh: '61', gotCh: '62' },
  { q: 'Girls Other Women s or girls', expCh: '62', gotCh: '61' },
  { q: 'Clay', expCh: '38', gotCh: '25' },
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

  for (const { q, expCh, gotCh } of QUERIES) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`(ch.${expCh}→ch.${gotCh}): "${q.slice(0, 65)}"`);

    const firing = rules.filter(r => patternMatches(r, q));
    if (firing.length === 0) { console.log('  No rules fire → pure semantic'); continue; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allowSet = new Set<any>();
    for (const r of firing) {
      const wl = r.whitelist ?? {};
      if (wl.allowChapters) for (const c of wl.allowChapters) allowSet.add(c);
    }

    const culprits = firing.filter(r => {
      const wl = r.whitelist as Any ?? {};
      const allow = wl.allowChapters ?? [];
      return allow.length > 0 && !allow.includes(expCh);
    });

    console.log(`  Firing: ${firing.length}, culprits (missing ch.${expCh}): ${culprits.length}`);
    for (const r of culprits.slice(0, 5)) {
      const wl = r.whitelist as Any ?? {};
      const pat = r.pattern as Any ?? {};
      const tokens = tokenize(q); const qLower = q.toLowerCase();
      const anyOfTriggers = (pat.anyOf ?? []).filter((t: string) => tokenOrPhraseMatches(t, tokens, qLower));
      const groupTriggers = (pat.anyOfGroups ?? []).map((g: string[]) => g.filter((t: string) => tokenOrPhraseMatches(t, tokens, qLower)));
      console.log(`    CULPRIT ${r.id}: allow=${JSON.stringify(wl.allowChapters)}`);
      console.log(`      anyOf hits: [${anyOfTriggers.join(', ')}]  groups: ${JSON.stringify(groupTriggers.filter((g: string[]) => g.length > 0))}`);
      console.log(`      pattern.anyOf: ${JSON.stringify(pat.anyOf)}`);
      console.log(`      pattern.noneOf: ${JSON.stringify(pat.noneOf)}`);
    }

    const helpful = firing.filter(r => {
      const wl = r.whitelist as Any ?? {};
      const allow = wl.allowChapters ?? [];
      return allow.includes(expCh);
    });
    console.log(`  Helpful rules (include ch.${expCh}): ${helpful.map((r: Any) => r.id).join(', ') || 'none'}`);

    if (allowSet.size > 0) {
      console.log(`  AllowSet: [${Array.from(allowSet).sort().join(',')}] → ch.${expCh} ${allowSet.has(expCh) ? 'INCLUDED ✓' : 'EXCLUDED ✗'}`);
    } else {
      console.log(`  AllowSet: empty → unrestricted → pure semantic picked ch.${gotCh}`);
    }
  }

  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
