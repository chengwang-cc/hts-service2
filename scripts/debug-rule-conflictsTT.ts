#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  // ch.72 thickness → ch.74 copper (why does copper fire?)
  "Other Of a thickness of less than 0.5 mm",
  "Of a thickness of 0.5 mm or more",
  // ch.30 → verify RR fix (should be open now)
  "Other Other Medicaments excluding goods of heading 3002 3005 or 3006 consisting of two or more constituents which have been mixed together for therapeutic or prophylactic uses",
  // ch.30 antiprotozoals  
  "Antiprotozoals excluding goods described in subheading note 2 to this chapter Other Medicaments",
  // ch.38 clay → ch.25
  "Clay",
  // any rules around "clay" that might interfere
];

function tokenize(query: string): Set<string> {
  const stop = new Set(['a','an','the','for','and','with','to','of','in','on','by','or','at','is','it','its','nor','other','than','from','not','as','be','if','no','so','do','up','use']);
  return new Set((query.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => !stop.has(t) && t.length > 1));
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();

  // Also dump rules with "copper" or "foil" or "strip" in description/id to understand ch.74 rules
  console.log('=== Rules with allowChapters:[74] ===');
  const ch74Rules = allRules.filter(r => r.whitelist?.allowChapters?.includes('74'));
  for (const r of ch74Rules) {
    console.log(`  ${r.id}: anyOf=${JSON.stringify(r.pattern?.anyOf)}`);
  }

  for (const q of QUERIES) {
    const tokens = tokenize(q);
    const qLower = q.toLowerCase();
    const matched = allRules.filter(r => r.pattern && patternMatches(r.pattern, tokens, qLower));

    const allowChRules = matched.filter(r => r.whitelist?.allowChapters?.length);
    const denyChRules = matched.filter(r => r.whitelist?.denyChapters?.length);
    const allowSet = new Set(allowChRules.flatMap(r => r.whitelist?.allowChapters ?? []));
    const denySet = new Set(denyChRules.flatMap(r => r.whitelist?.denyChapters ?? []));
    const surviving = [...allowSet].filter(ch => !denySet.has(ch));
    const isEmpty = allowSet.size > 0 && surviving.length === 0;

    console.log(`\n=== "${q.slice(0,80)}" ===`);
    console.log(`  Tokens: [${[...tokens].slice(0,15).join(', ')}]`);
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
