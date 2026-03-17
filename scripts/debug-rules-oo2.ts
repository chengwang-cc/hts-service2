/**
 * Debug rule firing for OO2 patch targets
 * Run: npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/debug-rules-oo2.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  { q: 'motorcycle seat cover', expCh: '94' },
  { q: 'monitor stand', expCh: '94' },
  { q: 'Wood Stand Place Card Business Card Retail Signage Holder', expCh: '44' },
  { q: '100% Tangwood bracelet', expCh: '44' },
  { q: 'Nylon jacket', expCh: '61' },
  { q: 'Handmade Paper Diorama', expCh: '69' },
  { q: 'Mustard Checkers Sponge Holder', expCh: '69' },
  { q: 'caseback screw for digital wristwatch', expCh: '73' },
  { q: 'Antique 1890s Blacksmith Solid Head Soldering Iron Hand Tool', expCh: '82' },
  { q: 'Xcelite Cable crimping kit Cooper Tools', expCh: '82' },
  { q: 'binding parts', expCh: '82' },
  { q: 'Stabilized wood blanks Alaskan yellow cedar burl', expCh: '44' },
  { q: 'water bottle tin', expCh: '73' },
  { q: 'Kids tin cup', expCh: '73' },
  { q: 'CD display box', expCh: '44' },
  { q: 'wall art metal tin small', expCh: '94' },
  { q: 'automotive switch', expCh: '94' },
];

type AnyRule = any;

function tokenize(q: string): Set<string> {
  return new Set(q.toLowerCase().split(/\s+/).map(t => t.replace(/[^a-z0-9]/g, '')).filter(Boolean));
}
function termMatch(term: string, tokens: Set<string>, qLower: string): boolean {
  if (term.includes(' ')) return qLower.includes(term);
  return tokens.has(term);
}
function anyOfGroupsMatch(groups: string[][], tokens: Set<string>, qLower: string): boolean {
  for (const group of groups) {
    if (!group.some(t => termMatch(t, tokens, qLower))) return false;
  }
  return true;
}
function patternMatches(rule: AnyRule, q: string): boolean {
  const tokens = tokenize(q);
  const qLower = q.toLowerCase();
  const p = rule.pattern as any;
  if (!p) return false;
  const required: string[] = p.required ?? [];
  for (const r of required) { if (!termMatch(r, tokens, qLower)) return false; }
  const anyOf: string[] = p.anyOf ?? [];
  const anyOfGroups: string[][] = p.anyOfGroups ?? [];
  const noneOf: string[] = p.noneOf ?? [];
  for (const n of noneOf) { if (termMatch(n, tokens, qLower)) return false; }
  const hasPositive = anyOf.length > 0 || anyOfGroups.length > 0 || required.length > 0;
  if (!hasPositive) return false;
  if (anyOf.length > 0 && !anyOf.some(t => termMatch(t, tokens, qLower))) return false;
  if (anyOfGroups.length > 0 && !anyOfGroupsMatch(anyOfGroups, tokens, qLower)) return false;
  return true;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });
    const allRules = svc.getAllRules() as AnyRule[];

    for (const { q, expCh } of QUERIES) {
      const firing = allRules.filter(r => patternMatches(r, q));
      const blocking = firing.filter(r => {
        const wl = (r.whitelist as any) ?? {};
        const chs: string[] = wl.allowChapters ?? [];
        return chs.length > 0 && !chs.includes(expCh) && !chs.includes(expCh.padStart(2, '0'));
      });
      console.log(`\n"${q.slice(0, 65)}" [exp ch.${expCh}]`);
      if (blocking.length === 0) {
        console.log(`  (no blocking rules — ranking issue)`);
        const withAllow = firing.filter(r => ((r.whitelist as any)?.allowChapters ?? []).length > 0);
        withAllow.slice(0, 3).forEach(r => {
          const wl = (r.whitelist as any) ?? {};
          console.log(`  fires (allows): ${r.id} → [${(wl.allowChapters ?? []).join(',')}]`);
        });
      } else {
        blocking.forEach(r => {
          const wl = (r.whitelist as any) ?? {};
          console.log(`  BLOCKS: ${r.id} → allowChapters=[${(wl.allowChapters ?? []).join(',')}]`);
        });
      }
    }
  } finally {
    await app.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
// Will add new queries below
