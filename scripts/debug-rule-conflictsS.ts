#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  // Verify KK fixes: jet type (should be open now)
  "Jet type Other",
  // Verify KK fixes: in shell (should be open)
  "Other Other In shell",
  // Verify KK fixes: 23% wool trousers (should be open/ch.61)
  "Containing 23 percent or more by by weight of wool or fine animal hair Trousers breeches and shorts",
  // Verify KK: acorns (should now have [23] surviving)
  "Acorns and horse-chestnuts",
  // Verify KK: corn gluten meal (should now have [23])
  "Corn gluten meal",
  // Verify KK+LL: preserved by sugar (should now have [20])
  "Other Vegetables fruit nuts fruit-peel and other parts of plants preserved by sugar drained glac or crystallized",
  // Verify JJ: paper machinery (should be open or have [84])
  "Machinery for finishing paper or paperboard Machinery for making pulp of fibrous cellulosic material or for making or finishing paper or paperboard other than the machinery of heading 8419 parts thereof",
  // Ongoing: glass inners vacuum flasks → ch.85 (ranking issue)
  "Glass inners for vacuum flasks or for other vacuum vessels",
  // Ongoing: prepared crustaceans → ch.03 (ranking issue, no rules)
  "Other Other Other crustaceans",
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

    console.log(`\n=== "${q.slice(0,90)}" ===`);
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
