#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  "Neither cooked nor in oil Eels Prepared or preserved fish caviar and caviar substitutes prepared from fish eggs",
  "Other Of synthetic fibers Women s or girls suits ensembles suit-type jackets blazers dresses skirts divided skirts trousers bib and brace overalls breeches and shorts other than swimwear knitted or crocheted",
];

function tokenize(query: string): Set<string> {
  const stop = new Set(['a','an','the','for','and','with','to','of','in','on','by','or','at','is','it','its','nor','other','than','from']);
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

    console.log(`\n=== "${q.slice(0,70)}" ===`);
    console.log(`  Tokens (sample): ${[...tokens].slice(0,20).join(', ')}`);
    if (allowChRules.length) {
      console.log(`  allowChapters:`);
      for (const r of allowChRules) console.log(`    ${r.id}: [${r.whitelist?.allowChapters?.join(',')}]`);
    } else { console.log(`  No allowChapters rules`); }
    if (denyChRules.length) {
      console.log(`  denyChapters: ${denyChRules.map(r => r.id + ':[' + r.whitelist?.denyChapters?.join(',') + ']').join(', ')}`);
    }
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
