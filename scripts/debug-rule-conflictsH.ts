#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  // ch.84 tapered roller bearings → ch.19
  "For cups having an outside diameter not exceeding 102 mm Tapered roller bearings including cone and tapered roller assemblies Ball or roller bearings and parts thereof",
  // ch.84 rotors → ch.88
  "Rotors not further advanced than cleaned or machined for removal of fins gates sprues and risers or to permit location in finishing machinery Parts",
  // ch.84 harvesting grading eggs → ch.04
  "Powered with the cutting device rotating in a horizontal plane Harvesting or threshing machinery including straw or fodder balers grass or hay mowers machines for cleaning sorting or grading eggs fruit or other agricultural produce other than machinery of heading 8437 parts thereof",
  // ch.72 steel with nickel percent → ch.75
  "Containing 8 percent or more but less than 24 percent by weight of nickel Other bars and rods",
  // ch.38 magnesium desulfurization → ch.30
  "Mixtures of a kind containing magnesium used as a desulfurization reagent Other",
  // ch.52 sheeting bleached → ch.13 (should be fixed by BB)
  "Sheeting Other Bleached",
  // ch.54 broadcloth → ch.51 (should be fixed by BB)
  "Poplin or broadcloth Of numbers 43 to 68 Plain weave weighing not more than 100 g/m",
];

function tokenize(query: string): Set<string> {
  const stop = new Set(['a','an','the','for','and','with','to','of','in','on','by','or','at','is','it','its','nor','other','than','from','not','as','be','if','no','so','do','up','use']);
  return new Set((query.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => !stop.has(t) && t.length > 1));
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });

  for (const q of QUERIES) {
    const tokens = tokenize(q);
    const qLower = q.toLowerCase();
    const allRules = svc.getAllRules();
    const matched = allRules.filter(r => r.pattern && patternMatches(r.pattern, tokens, qLower));

    const allowChRules = matched.filter(r => r.whitelist?.allowChapters?.length);
    const denyChRules = matched.filter(r => r.whitelist?.denyChapters?.length);
    const allowSet = new Set(allowChRules.flatMap(r => r.whitelist?.allowChapters ?? []));
    const denySet = new Set(denyChRules.flatMap(r => r.whitelist?.denyChapters ?? []));
    const surviving = [...allowSet].filter(ch => !denySet.has(ch));
    const isEmpty = allowSet.size > 0 && surviving.length === 0;

    console.log(`\n=== "${q.slice(0,80)}" ===`);
    if (allowChRules.length) {
      for (const r of allowChRules)
        console.log(`  ALLOW ${r.id}: [${r.whitelist?.allowChapters?.join(',')}]`);
    } else {
      console.log(`  (no allowChapters restrictions)`);
    }
    for (const r of denyChRules)
      console.log(`  DENY  ${r.id}: [${r.whitelist?.denyChapters?.join(',')}]`);
    if (isEmpty) console.log(`  *** EMPTY ***`);
    else if (allowSet.size > 0) console.log(`  Surviving: [${surviving.join(',')}]`);
    else console.log(`  (no chapter restrictions — open)`);
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
