import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  // 3 remaining cross-chapter failures
  { q: 'Other Cases boxes crates drums and similar packings cable-drums Packing cases boxes crates drums and similar packings of wood cable-drums of wood pallets box-pallets and other load boards of wood pallet collars of wood', expCh: '44', gotCh: '92' },
  { q: 'Thermal undershirts Of man-made fibers Of other textile materials Women s or girls', expCh: '61', gotCh: '62' },
  { q: 'Containing 5 percent or more by weight of elastomeric yarn or rubber thread Other', expCh: '61', gotCh: '52' },
  // Tractable within-chapter
  { q: 'Other Other In shell', expCh: '12', gotCh: '93' },
  // ch.72→ch.74 (steel flat-rolled thin)
  { q: 'Other Of a thickness of less than 0.5 mm', expCh: '72', gotCh: '74' },
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

  if (p.required) {
    for (const r of p.required) {
      if (!tokenOrPhraseMatches(r, tokens, qLower)) return false;
    }
  }
  if (p.noneOf) {
    for (const n of p.noneOf) {
      if (tokenOrPhraseMatches(n, tokens, qLower)) return false;
    }
  }
  if (p.anyOf && p.anyOf.length > 0) {
    if (!p.anyOf.some((t: string) => tokenOrPhraseMatches(t, tokens, qLower))) return false;
  }
  if (p.anyOfGroups) {
    for (const group of p.anyOfGroups) {
      if (group.length > 0 && !group.some((t: string) => tokenOrPhraseMatches(t, tokens, qLower))) return false;
    }
  }
  return true;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const rules = svc.getAllRules();

  for (const { q, expCh, gotCh } of QUERIES) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`QUERY: "${q.slice(0, 80)}"`);
    console.log(`Expected ch.${expCh} → got ch.${gotCh}`);

    const firing = rules.filter(r => patternMatches(r, q));
    if (firing.length === 0) {
      console.log('  No rules fire — falls back to semantic');
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allowSet = new Set<any>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const denySet = new Set<any>();
    for (const r of firing) {
      const wl = r.whitelist ?? {};
      if (wl.allowChapters) for (const c of wl.allowChapters) allowSet.add(c);
      if (wl.denyChapters) for (const c of wl.denyChapters) denySet.add(c);
    }
    for (const d of denySet) allowSet.delete(d);

    console.log(`  Firing rules (${firing.length}):`);
    for (const r of firing) {
      const wl = r.whitelist as AnyRule ?? {};
      const pat = r.pattern as AnyRule ?? {};
      const noneOf = pat.noneOf ?? [];
      console.log(`    ${r.id}: allow=${JSON.stringify(wl.allowChapters ?? [])}, deny=${JSON.stringify(wl.denyChapters ?? [])}, noneOf-count=${noneOf.length}`);
    }
    if (allowSet.size > 0) {
      console.log(`  AllowSet: [${Array.from(allowSet).sort().join(',')}]`);
      console.log(`  ch.${expCh} allowed: ${allowSet.has(expCh)}, ch.${gotCh} allowed: ${allowSet.has(gotCh)}`);
    } else {
      console.log(`  No allowChapters → unrestricted (deny: [${Array.from(denySet).sort().join(',')}])`);
    }
  }

  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
