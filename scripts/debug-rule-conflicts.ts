#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  "Of iron or nonalloy steel Other Other tubes and pipes for example welded riveted or similarly closed having circular cross sections",
  "Gear hobbers Gear cutting machines",
  "Pink humpie In oil in airtight containers Salmon",
];

function tokenize(query: string): Set<string> {
  const stopWords = new Set(['a','an','the','for','and','with','to','of','in','on','by','or','at','is','it','its']);
  const raw = query.toLowerCase().match(/[a-z0-9]+/g) || [];
  return new Set(raw.filter(t => !stopWords.has(t)));
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });

  for (const q of QUERIES) {
    const tokens = tokenize(q);
    const qLower = q.toLowerCase();
    const allRules = svc.getAllRules();
    const matched = allRules.filter(r => r.pattern && patternMatches(r.pattern, tokens, qLower));

    // Filter to rules that have allowChapters (which can cause EMPTY when combined with denyChapters)
    const allowChRules = matched.filter(r => r.whitelist?.allowChapters?.length);
    const denyChRules = matched.filter(r => r.whitelist?.denyChapters?.length);

    console.log(`\n=== Query: "${q.slice(0,60)}" ===`);
    console.log(`  Matched: ${matched.length} rules total`);
    console.log(`  Rules with allowChapters:`);
    for (const r of allowChRules) {
      console.log(`    ${r.id} → allowChapters: [${r.whitelist?.allowChapters?.join(',')}]`);
    }
    console.log(`  Rules with denyChapters:`);
    for (const r of denyChRules) {
      console.log(`    ${r.id} → denyChapters: [${r.whitelist?.denyChapters?.join(',')}]`);
    }

    // Find conflicts: allowChapters X and denyChapters X
    const allowSet = new Set(allowChRules.flatMap(r => r.whitelist?.allowChapters ?? []));
    const denySet = new Set(denyChRules.flatMap(r => r.whitelist?.denyChapters ?? []));
    const conflicts = [...allowSet].filter(ch => denySet.has(ch));
    if (conflicts.length) {
      console.log(`  *** CONFLICT (allowChapters ∩ denyChapters): [${conflicts.join(',')}]`);
    }

    // Also check: if ALL allowChapters are in denyChapters = EMPTY
    const allAllowed = [...allowSet];
    if (allAllowed.length > 0 && allAllowed.every(ch => denySet.has(ch))) {
      console.log(`  *** EMPTY: every allowChapter is also denied`);
    }
  }

  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
// Temp: print specific rules
