/**
 * Debug blocking rules for OO2 patch targets — round 2
 * Run: npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/debug-rules-oo2b.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  { q: 'Empty Beer Bottle', expCh: '70' },
  { q: 'Vintage Avon White Ballerina Perfume Bottle Collectible', expCh: '70' },
  { q: 'Fusion Mineral Paint Tough Coat Wipe-on Poly 500ml', expCh: '39' },
  { q: 'DECORATIVE RED COTTON THROW PILLOW COVER', expCh: '63' },
  { q: 'motorcycle seat cover', expCh: '94' },
  { q: 'custom phone case', expCh: '42' },
  { q: 'crystal figurine', expCh: '70' },
  { q: '4-PIN WIRE HARNESS', expCh: '85' },
  { q: 'Acrylic Keychain anime', expCh: '39' },
  { q: 'water bottle tin', expCh: '73' },
  { q: 'Kids tin cup', expCh: '73' },
  { q: 'wall art metal tin small', expCh: '94' },
  { q: 'monitor stand computer desk', expCh: '94' },
  { q: 'Cotton Bed Sheet Set', expCh: '63' },
  { q: 'Pillow Case', expCh: '63' },
  { q: 'Cotton custom dolls', expCh: '63' },
  { q: 'antique soldering iron hand tool blacksmith', expCh: '82' },
  { q: 'bearing set engine', expCh: '84' },
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
  for (const group of groups) { if (!group.some(t => termMatch(t, tokens, qLower))) return false; }
  return true;
}
function patternMatches(rule: AnyRule, q: string): boolean {
  const tokens = tokenize(q); const qLower = q.toLowerCase();
  const p = rule.pattern as any; if (!p) return false;
  const required: string[] = p.required ?? [];
  for (const r of required) { if (!termMatch(r, tokens, qLower)) return false; }
  const anyOf: string[] = p.anyOf ?? []; const anyOfGroups: string[][] = p.anyOfGroups ?? []; const noneOf: string[] = p.noneOf ?? [];
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
        const chs: string[] = (r.whitelist as any)?.allowChapters ?? [];
        return chs.length > 0 && !chs.includes(expCh) && !chs.includes(expCh.padStart(2, '0'));
      });
      console.log(`\n"${q.slice(0, 65)}" [exp ch.${expCh}]`);
      if (blocking.length === 0) {
        const withAllow = firing.filter(r => ((r.whitelist as any)?.allowChapters ?? []).length > 0);
        if (withAllow.length === 0) console.log(`  (no blocking, no allowing — pure ranking)`);
        else withAllow.slice(0, 4).forEach(r => console.log(`  fires (allows): ${r.id} → [${((r.whitelist as any)?.allowChapters ?? []).join(',')}]`));
      } else {
        blocking.slice(0, 5).forEach(r => console.log(`  BLOCKS: ${r.id} → [${((r.whitelist as any)?.allowChapters ?? []).join(',')}]`));
      }
    }
  } finally { await app.close(); }
}
main().catch(e => { console.error(e); process.exit(1); });
