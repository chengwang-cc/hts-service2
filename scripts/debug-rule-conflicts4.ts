#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  // ch.84 failures
  "Powered with the cutting device rotating in a horizontal plane Harvesting or threshing machinery including straw or fodder balers grass or hay mowers machines for cleaning sorting or grading eggs fruit or other agricultural produce other than machinery of heading 8437 parts thereof",
  "Other Of poultry-keeping machinery or poultry incubators and brooders",
  "Tamping machines and road rollers Self-propelled bulldozers angledozers graders levelers scrapers mechanical shovels excavators shovel loaders tamping machines and road rollers",
  "Gear boxes and parts thereof For other vehicles",
  // ch.85 failures
  "Graphics processing units GPUs Processors and controllers whether or not combined with memories converters logic circuits amplifiers clock and timing circuits or other circuits Electronic integrated circuits parts thereof",
  "Of an output exceeding 74.6 W but not exceeding 735 W Other AC motors single-phase Electric motors and generators excluding generating sets",
  "Other including flat packs For a power handling capacity not exceeding 20 W Electrical resistors including rheostats and potentiometers other than heating resistors parts thereof",
  // ch.76 -> ch.92
  "Mobile homes Other Aluminum structures excluding prefabricated buildings of heading 9406 and parts of structures for example bridges and bridge-sections towers lattice masts roofs roofing frameworks doors and windows and their frames and thresholds for doors balustrades pillars and columns aluminum plates rods profiles tubes and the like prepared for use in structures",
  // ch.64 -> ch.89/03/07
  "For men Made on a base or platform of wood Other",
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

    console.log(`\n=== "${q.slice(0,70)}" ===`);
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
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
