import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  { q: 'Other Of synthetic fibers Women s or girls suits ensembles suit-type jackets blazers dresses skirts divided skirts trousers bib and brace overalls breeches and shorts other than swimwear knitted or crocheted', expCh: '61', gotCh: '61', expected: '6104.13.20.00', got: '6104.23.00.14' },
  { q: 'Men s or boys Other Of other textile materials', expCh: '61', gotCh: '62', expected: '6109.90.80.10', got: '6203.39.20.20' },
  { q: 'Shirts Of artificial fibers', expCh: '61', gotCh: '62', expected: '6103.29.10.50', got: '6211.43.05.60' },
  { q: 'Girls Other Women s or girls', expCh: '62', gotCh: '61', expected: '6211.12.80.20', got: '6104.44.20.20' },
  { q: 'Trousers of worsted wool fabric made of wool yarn having an average fiber diameter of 18.5 microns or less', expCh: '62', gotCh: '62', expected: '6203.41.03', got: '6203.29.10.20' },
  { q: 'Other Other Retreaded or used pneumatic tires of rubber solid or cushion tires tire treads and tire flaps of rubber', expCh: '40', gotCh: '40', expected: '4012.19.80.00', got: '4012.90.10.00' },
  { q: 'Other Other Other crustaceans', expCh: '16', gotCh: '03', expected: '1605.40.10.90', got: '0306.11.00.10' },
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
    console.log(`(ch.${expCh}→ch.${gotCh}): "${q.slice(0, 65)}"`);
    console.log(`Expected: ${expected}, Got: ${got}`);

    const firing = rules.filter(r => patternMatches(r, q));
    const allowSet = new Set<string>();
    for (const r of firing) {
      const wl = r.whitelist ?? {};
      if ((wl as Any).allowChapters) for (const c of (wl as Any).allowChapters) allowSet.add(c);
    }

    if (firing.length === 0) { console.log('  No rules fire → pure semantic'); continue; }
    console.log(`  AllowChapters union: [${Array.from(allowSet).sort().join(',')}]`);
    console.log(`  Firing (${firing.length}): ${firing.slice(0,6).map((r: Any) => r.id).join(', ')}...`);
    for (const r of firing) {
      const wl = r.whitelist as Any ?? {};
      const inj = (r.inject as Any[]) ?? [];
      const boosts = (r.boosts as Any[]) ?? [];
      if ((wl.allowChapters && !wl.allowChapters.includes(expCh)) || inj.length > 0) {
        console.log(`    CULPRIT? ${r.id}: allow=[${wl.allowChapters?.join(',')}], inject=[${inj.map((s: Any) => s.prefix+'@'+s.syntheticRank).join(',')}], boosts=[${boosts.map((b: Any) => (b.prefixMatch||b.chapterMatch||'?')+'@'+b.delta).join(',')}]`);
      }
    }
  }

  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
