#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  // ch.38 "Mixtures containing magnesium desulfurization" → ch.30
  "Mixtures of a kind containing magnesium used as a desulfurization reagent Other",
  // ch.38 "Clay" → ch.25
  "Clay",
  // ch.64 footwear → within-chapter (for debugging)
  "For men Protective active footwear except footwear with waterproof molded bottoms including bottoms comprising an outer sole and all or part of the upper and except footwear with insulation that provides protection against cold weather whose height from the bottom of the outer sole to the top of the upper does not exceed 15.34 cm Covering the ankle",
  // ch.72 steel
  "Containing 8 percent or more but less than 24 percent by weight of nickel Other bars and rods",
  // ch.62 blouses "Of other textile materials"
  "Girls Other Women s or girls",
  // ch.52 cotton yarn
  "Exceeding 80 nm Cotton yarn other than sewing thread containing less than 85 percent by weight of cotton not put up for retail sale",
  // ch.84 harvesting (the grading-eggs failure)
  "Powered with the cutting device rotating in a horizontal plane Harvesting or threshing machinery including straw or fodder balers grass or hay mowers machines for cleaning sorting or grading eggs fruit or other agricultural produce other than machinery of heading 8437 parts thereof",
  // ch.16 crustaceans
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

    console.log(`\n=== "${q.slice(0,80)}" ===`);
    console.log(`  tokens: ${[...tokens].join(', ')}`);
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
