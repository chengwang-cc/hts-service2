import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  { q: 'Birch Betula spp.', expCh: '44', gotCh: '44', expected: '4408.90.01.10', got: '4412.33.06.40' },
  { q: 'Mahogany Swietenia spp.', expCh: '44', gotCh: '44', expected: '4407.21.00.00', got: '4412.33.32.55' },
  { q: 'Other With a face ply of birch Betula spp.', expCh: '44', gotCh: '44', expected: '4412.31.06.60', got: '4412.33.32.35' },
  { q: 'Other Other Retreaded or used pneumatic tires of rubber solid or cushion tires tire treads and tire flaps of rubber', expCh: '40', gotCh: '40', expected: '4012.19.80.00', got: '4012.90.10.00' },
  { q: 'For women With uppers of vegetable fibers With uppers of textile materials', expCh: '64', gotCh: '64', expected: '6405.20.30.60', got: '6404.19.37.60' },
  { q: 'Other Tobacco not stemmed/stripped', expCh: '24', gotCh: '24', expected: '2401.10.29', got: '2401.10.61.30' },
  { q: 'Girls Other Women s or girls', expCh: '62', gotCh: '61', expected: '6211.12.80.20', got: '6104.44.20.20' },
  { q: 'Carrot', expCh: '12', gotCh: '07', expected: '1209.91.80.10', got: '0706.10.05.00' },
  { q: 'Tomato', expCh: '12', gotCh: '07', expected: '1209.91.80.70', got: '0702.00.20.04' },
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
    const allowPrefixSet = new Set<string>();
    for (const r of firing) {
      const wl = r.whitelist ?? {};
      if (wl.allowChapters) for (const c of wl.allowChapters) allowSet.add(c);
      if (wl.allowPrefixes) for (const p of wl.allowPrefixes) allowPrefixSet.add(p);
    }

    console.log(`  Firing rules: ${firing.map((r: Any) => r.id).join(', ')}`);
    console.log(`  AllowChapters: [${Array.from(allowSet).sort().join(',')}]`);

    for (const r of firing) {
      const wl = r.whitelist as Any ?? {};
      const inj = r.inject ?? [];
      const boosts = r.boosts ?? [];
      if (wl.allowChapters || wl.allowPrefixes || inj.length > 0 || boosts.length > 0) {
        console.log(`    ${r.id}: allow=[${wl.allowChapters?.join(',')}], inject=[${(inj as Any[]).map((s: Any) => s.prefix+'@'+s.syntheticRank).join(',')}], boosts=[${(boosts as Any[]).map((b: Any) => (b.prefixMatch||b.chapterMatch||'?')+'@'+b.delta).join(',')}]`);
      }
    }
  }

  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
