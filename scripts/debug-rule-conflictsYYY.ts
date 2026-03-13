/**
 * Debug script: inspect rule firing for remaining cross-chapter failures after patch WW
 * Run: npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/debug-rule-conflictsYYY.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const FAILING_QUERIES = [
  { q: 'Bars and rods of copper-nickel base alloys cupro-nickel or copper-nickel-zinc base alloys nickel silver Other Copper bars rods and profiles', expCh: '74', gotCh: '79' },
  { q: 'Other parts of hair clippers Parts', expCh: '85', gotCh: '96' },
  { q: 'Other Of cellular rubber or plastics whether or not covered', expCh: '94', gotCh: '40' },
  { q: 'Photographic plates film paper paperboard and textiles exposed but not developed', expCh: '37', gotCh: '48' },
  { q: 'Other Woven fabrics of jute or of other textile bast fibers of heading 5303', expCh: '53', gotCh: '64' },
  { q: 'Paraffin wax containing by weight less than 0.75 percent of oil Petroleum jelly paraffin wax microcrystalline petroleum wax slack wax ozokerite lignite wax peat wax other mineral waxes and similar products obtained by synthesis or by other processes whether or not colored', expCh: '27', gotCh: '20' },
  { q: 'Other Mattocks picks hoes and rakes and parts thereof Handtools of the following kinds and base metal parts thereof spades shovels mattocks picks hoes forks and rakes axes bill hooks and similar hewing tools secateurs and pruners of any kind scythes sickles hay knives hedge shears timber wedges and other tools of a kind used in agriculture horticulture or forestry', expCh: '82', gotCh: '92' },
  { q: 'Other Other Other crustaceans', expCh: '16', gotCh: '03' },
  { q: 'Clay', expCh: '38', gotCh: '25' },
  { q: 'Other Other In shell', expCh: '12', gotCh: '93' },
  { q: 'Carrot', expCh: '12', gotCh: '07' },
  { q: 'Tomato', expCh: '12', gotCh: '07' },
  { q: 'Containing mainly vanadium Other', expCh: '26', gotCh: '81' },
  { q: 'Other Weighing over 30 g/m', expCh: '48', gotCh: '93' },
  { q: 'Other 0.3 mm or more in thickness', expCh: '48', gotCh: '70' },
];

function tokenize(q: string): Set<string> {
  return new Set(q.toLowerCase().split(/\s+/).map(t => t.replace(/[^a-z0-9]/g, '')).filter(Boolean));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRule = any;

function anyOfGroupsMatch(groups: string[][], tokens: Set<string>, qLower: string): boolean {
  for (const group of groups) {
    const groupMatch = group.some(term => {
      if (term.includes(' ')) return qLower.includes(term);
      return tokens.has(term);
    });
    if (!groupMatch) return false;
  }
  return true;
}

function patternMatches(rule: AnyRule, q: string): boolean {
  const tokens = tokenize(q);
  const qLower = q.toLowerCase();
  const p = rule.pattern as any;
  if (!p) return false;

  const required: string[] = p.required ?? [];
  for (const r of required) {
    if (r.includes(' ')) { if (!qLower.includes(r)) return false; }
    else { if (!tokens.has(r)) return false; }
  }

  const anyOf: string[] = p.anyOf ?? [];
  const anyOfGroups: string[][] = p.anyOfGroups ?? [];
  const noneOf: string[] = p.noneOf ?? [];

  for (const n of noneOf) {
    if (n.includes(' ')) { if (qLower.includes(n)) return false; }
    else { if (tokens.has(n)) return false; }
  }

  if (anyOf.length > 0 || anyOfGroups.length > 0) {
    const anyOfMatch = anyOf.length === 0 || anyOf.some(term => {
      if (term.includes(' ')) return qLower.includes(term);
      return tokens.has(term);
    });
    const groupsMatch = anyOfGroups.length === 0 || anyOfGroupsMatch(anyOfGroups, tokens, qLower);
    if (!anyOfMatch || !groupsMatch) return false;
  }

  return true;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const rules = svc.getAllRules();

  for (const { q, expCh, gotCh } of FAILING_QUERIES) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`QUERY: "${q.slice(0, 80)}..."`);
    console.log(`Expected ch.${expCh} → got ch.${gotCh}`);

    const firing = rules.filter(r => patternMatches(r, q));
    if (firing.length === 0) {
      console.log('  No rules fire — falls back to semantic');
      continue;
    }

    // Compute allowSet and denySet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let allowSet = new Set<any>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const denySet = new Set<any>();
    for (const r of firing) {
      const wl = r.whitelist ?? {};
      if (wl.allowChapters) for (const c of wl.allowChapters) allowSet.add(c);
      if (wl.denyChapters) for (const c of wl.denyChapters) denySet.add(c);
    }
    for (const d of denySet) allowSet.delete(d);

    const expChNum = parseInt(expCh, 10);
    const gotChNum = parseInt(gotCh, 10);
    const expAllowed = allowSet.size === 0 || allowSet.has(expChNum);
    const gotAllowed = allowSet.size === 0 || allowSet.has(gotChNum);

    console.log(`  Firing rules (${firing.length}):`);
    for (const r of firing.slice(0, 10)) {
      const wl = r.whitelist as any ?? {};
      console.log(`    ${r.id}: allow=${JSON.stringify(wl.allowChapters ?? [])}, deny=${JSON.stringify(wl.denyChapters ?? [])}`);
    }
    if (allowSet.size > 0) {
      console.log(`  AllowSet (${allowSet.size}): [${Array.from(allowSet).sort((a,b)=>a-b).join(',')}]`);
      console.log(`  ch.${expCh} allowed: ${expAllowed}, ch.${gotCh} allowed: ${gotAllowed}`);
    } else {
      console.log(`  No allowChapters → unrestricted (deny only: [${Array.from(denySet).sort((a,b)=>a-b).join(',')}])`);
    }
  }

  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
