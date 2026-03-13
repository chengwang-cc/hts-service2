#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  // Still EMPTY after patch R
  "Derived from coconut Activated carbon Activated carbon activated natural mineral products animal black including spent animal black",
  "Measuring less than 77 cm in width or less than 77 cm between selvages the thread count of which per cm treating multiple folded or cabled yarns as single threads is over 69 but not over 142 in the warp and over 31 but not over 71 in the filling",
  // ch.84 still failing (grading eggs → ch.04)
  "Powered with the cutting device rotating in a horizontal plane Harvesting or threshing machinery including straw or fodder balers grass or hay mowers machines for cleaning sorting or grading eggs fruit or other agricultural produce other than machinery of heading 8437 parts thereof",
  // ch.12 seeds going to ch.07
  "Carrot",
  "Tomato",
  // ch.41 leather going to ch.02
  "Upper leather sole leather Grain splits Leather further prepared after tanning or crusting including parchment-dressed leather of bovine including buffalo or equine animals without hair on whether or not split other than leather of heading 4114",
  // ch.52 cotton fabric going to ch.67
  "Duck except plain weave Other fabrics Woven fabrics of cotton containing less than 85 percent by weight of cotton mixed mainly or solely with man-made fibers weighing more than 200 g/m",
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
