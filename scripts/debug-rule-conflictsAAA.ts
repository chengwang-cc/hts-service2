import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  { q: 'Other Animal vegetable or microbial fats and oils and their fractions boiled oxidized dehydrated sulfurized blown polymerized by heat in vacuum or in inert gas or otherwise chemically modified excluding those of heading 1516 inedible mixtures or preparations of animal vegetable or microbial fats or oils or of fractions of different fats or oils of this chapter not elsewhere specified or included', expCh: '15', gotCh: '85' },
  { q: 'Articles for monumental or building purposes of subheading 6802.23.00 not cut to size with only one face surface-worked more than simply cut or sawn Granite Worked monumental or building stone except slate and articles thereof other than goods of heading 6801 mosaic cubes and the like of natural stone including slate whether or not on a backing artificially colored granules chippings and powder of natural stone including slate', expCh: '68', gotCh: '84' },
  { q: 'Other Weighing over 30 g/m', expCh: '48', gotCh: '93' },
  { q: 'Other Other of polyethylene or polypropylene strip or the like Sacks and bags of a kind used for the packing of goods', expCh: '63', gotCh: '54' },
  { q: 'Other Containing by weight 5 percent or more of elastomeric yarn but not containing rubber thread Knitted or crocheted fabrics of a width exceeding 30 cm containing by weight 5 percent or more of elastomeric yarn or rubber thread other than those of heading 6001', expCh: '60', gotCh: '52' },
  { q: 'Circular knit wholly of cotton yarns exceeding 100 metric number per single yarn Unbleached or bleached Other knitted or crocheted fabrics', expCh: '60', gotCh: '52' },
  { q: 'Cords braids and the like of a kind used in industry as packing or lubricating material', expCh: '59', gotCh: '58' },
  { q: 'Girls Other Women s or girls', expCh: '62', gotCh: '61' },
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
    console.log(`QUERY (ch.${expCh}→ch.${gotCh}): "${q.slice(0, 70)}"`);

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

    // Show only rules that contribute to allowSet misrouting
    const culprits = firing.filter(r => {
      const wl = r.whitelist as Any ?? {};
      const allow = wl.allowChapters ?? [];
      return allow.length > 0 && !allow.includes(expCh);
    });

    console.log(`  Total firing: ${firing.length}, culprits (wrong chapter): ${culprits.length}`);
    for (const r of culprits) {
      const wl = r.whitelist as Any ?? {};
      const pat = r.pattern as Any ?? {};
      // Find which anyOf/anyOfGroups term triggered
      const tokens = tokenize(q);
      const qLower = q.toLowerCase();
      const triggers = (pat.anyOf ?? []).filter((t: string) => tokenOrPhraseMatches(t, tokens, qLower));
      console.log(`    ${r.id}: allow=${JSON.stringify(wl.allowChapters)}, triggers=[${triggers.join(',')}]`);
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
