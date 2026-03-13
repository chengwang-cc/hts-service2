#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  "For marine propulsion engines Other",
  "Other Products containing fish meat prepared meals Lobster",
  "Neither cooked nor in oil Eels Prepared or preserved fish caviar and caviar substitutes prepared from fish eggs",
];

function tokenize(query: string): Set<string> {
  const stop = new Set(['a','an','the','for','and','with','to','of','in','on','by','or','at','is','it','its','nor']);
  return new Set((query.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => !stop.has(t)));
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
    const conflicts = [...allowSet].filter(ch => denySet.has(ch));

    console.log(`\n=== "${q.slice(0,60)}" ===`);
    console.log(`  Tokens: ${[...tokens].join(', ')}`);
    if (allowChRules.length) {
      console.log(`  allowChapters rules:`);
      for (const r of allowChRules) console.log(`    ${r.id}: [${r.whitelist?.allowChapters?.join(',')}]`);
    }
    if (denyChRules.length) {
      console.log(`  denyChapters rules:`);
      for (const r of denyChRules) console.log(`    ${r.id}: [${r.whitelist?.denyChapters?.join(',')}]`);
    }
    if (conflicts.length) console.log(`  *** CONFLICT: [${conflicts.join(',')}]`);
    const surviving = [...allowSet].filter(ch => !denySet.has(ch));
    console.log(`  Surviving chapters (after allow+deny): [${surviving.join(',') || 'NONE=EMPTY'}]`);
  }

  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
