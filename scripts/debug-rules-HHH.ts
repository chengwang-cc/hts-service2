import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  { q: 'Other With a face ply of birch Betula spp.', expCh: '44', gotCh: '44', expected: '4412.31.06.60', got: '4412.33.32.35' },
  { q: 'With a face ply of birch Betula spp. Other with at least one outer ply of nonconiferous wood', expCh: '44', gotCh: '44', expected: '4412.52.10', got: '4412.33.06.40' },
  { q: 'Other Valued over 2.50/pair', expCh: '64', gotCh: '64', expected: '6403.99.90.31', got: '6402.19.50.31' },
  { q: 'Other Other Other crustaceans', expCh: '16', gotCh: '03', expected: '1605.40.10.90', got: '0306.11.00.10' },
  { q: 'Other Head lettuce cabbage lettuce', expCh: '07', gotCh: '07', expected: '0705.11.40.00', got: '0709.99.30.00' },
  { q: 'Other Sweet potatoes Cassava manioc arrowroot salep Jerusalem artichokes sweet potatoes and similar roots and tubers with high starch or inulin content fresh chilled frozen or dried whether or not sliced or in the form of pellets sago pith', expCh: '07', gotCh: '07', expected: '0714.20.20.00', got: '0714.90.51.00' },
  { q: 'Pineapples', expCh: '08', gotCh: '08', expected: '0811.90.50', got: '0804.30.20.00' },
  { q: 'Other Shelled Other nuts fresh or dried whether or not shelled or peeled', expCh: '08', gotCh: '08', expected: '0802.12.00.15', got: '0802.52.00.00' },
  { q: 'Other Glass wool and articles of glass wool', expCh: '70', gotCh: '70', expected: '7019.80.90.00', got: '7019.90.51.20' },
  { q: 'Other Closed woven fabrics of rovings', expCh: '70', gotCh: '70', expected: '7019.61.10.00', got: '7019.62.40.30' },
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
    console.log(`(ch.${expCh}→${gotCh}): "${q.slice(0, 65)}"`);
    console.log(`Expected: ${expected}, Got: ${got}`);

    const firing = rules.filter(r => patternMatches(r, q));
    if (firing.length === 0) { console.log('  No rules fire → pure semantic'); continue; }

    const allowSet = new Set<string>();
    for (const r of firing) {
      const wl = r.whitelist ?? {};
      if (wl.allowChapters) for (const c of wl.allowChapters) allowSet.add(c);
    }

    console.log(`  Firing: ${firing.map((r: Any) => r.id).join(', ')}`);
    console.log(`  AllowChapters union: [${Array.from(allowSet).sort().join(',')}]`);

    for (const r of firing) {
      const wl = r.whitelist as Any ?? {};
      const inj = (r.inject as Any[]) ?? [];
      const boosts = (r.boosts as Any[]) ?? [];
      if (wl.allowChapters || inj.length > 0 || boosts.length > 0) {
        console.log(`    ${r.id}: allow=[${wl.allowChapters?.join(',')}], inject=[${inj.map(s => s.prefix+'@'+s.syntheticRank).join(',')}], boosts=[${boosts.map(b => (b.prefixMatch||b.chapterMatch||'?')+'@'+b.delta).join(',')}]`);
      }
    }
  }

  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
