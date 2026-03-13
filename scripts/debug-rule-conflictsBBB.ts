import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  { q: 'Satin weave or twill weave Dyed Woven fabrics of artificial staple fibers', expCh: '55', gotCh: '54' },
  { q: 'Cheesecloth lawns voiles or batistes Mixed mainly or solely with viscose rayon staple fibers', expCh: '55', gotCh: '52' },
  { q: 'Articles for monumental or building purposes of subheading 6802.23.00 not cut to size with only one face surface-worked more than simply cut or sawn Granite Worked monumental or building stone except slate and articles thereof other than goods of heading 6801 mosaic cubes and the like of natural stone including slate whether or not on a backing artificially colored granules chippings and powder of natural stone including slate', expCh: '68', gotCh: '84' },
  { q: 'Other Beef in airtight containers', expCh: '16', gotCh: '16' }, // within-chapter
  { q: 'Other Other Other crustaceans', expCh: '16', gotCh: '03' },
  { q: 'Containing 5 percent or more by weight of elastomeric yarn or rubber thread Other', expCh: '61', gotCh: '52' },
  { q: 'Other Other In shell', expCh: '12', gotCh: '93' },
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
    for (const d of denySet) allowSet.delete(d);

    const culprits = firing.filter(r => {
      const wl = r.whitelist as Any ?? {};
      const allow = wl.allowChapters ?? [];
      return allow.length > 0 && !allow.includes(expCh);
    });

    console.log(`  Total firing: ${firing.length}, culprits (wrong ch): ${culprits.length}`);
    for (const r of culprits.slice(0, 5)) {
      const wl = r.whitelist as Any ?? {};
      const pat = r.pattern as Any ?? {};
      const tokens = tokenize(q); const qLower = q.toLowerCase();
      const triggers = (pat.anyOf ?? []).filter((t: string) => tokenOrPhraseMatches(t, tokens, qLower));
      const groupTriggers = (pat.anyOfGroups ?? []).map((g: string[]) => g.filter((t: string) => tokenOrPhraseMatches(t, tokens, qLower)));
      console.log(`    ${r.id}: allow=${JSON.stringify(wl.allowChapters)}, triggers=[${triggers.join(',')}] groups=${JSON.stringify(groupTriggers.filter((g: string[]) => g.length > 0))}`);
    }
    if (allowSet.size > 0) {
      console.log(`  AllowSet: [${Array.from(allowSet).sort().join(',')}] → ch.${expCh} ${allowSet.has(expCh) ? 'INCLUDED' : 'EXCLUDED'}`);
    } else {
      console.log(`  No allowChapters → unrestricted`);
    }
  }

  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
