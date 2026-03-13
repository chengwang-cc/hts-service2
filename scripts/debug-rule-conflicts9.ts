#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  // ch.87 → ch.56: tractor going to netting?
  "With a net engine power of 257.4 kW or more Suitable for agricultural use",
  // ch.62 → ch.95: garment going to sporting goods
  "Ski/snowboard pants Other Other men s or boys garments",
  // ch.29 → ch.22: organic chemicals going to beverages
  "Containing a phosphorus atom to which one methyl ethyl n-propyl or isopropyl group is bonded but no further carbon atoms Other Other organo-inorganic compounds",
  "2- N N-Diethylamino ethyl chloride hydrochloride",
  // ch.96 → ch.58: printing ribbons going to woven fabrics
  "Thermal transfer printing ribbons of coated polyethylene terephthalate film Other Ribbons",
  // ch.96 → ch.39: buttons going to plastics
  "Of acrylic resin of polyester resin or of both such resins Of plastics not covered with textile material Buttons press-fasteners snap-fasteners and press-studs button molds and other parts of these articles button blanks",
  // ch.72 → ch.11: steel section going to cereal grain
  "Other Hot-rolled not drilled not punched and not otherwise advanced Angles shapes and sections",
  // ch.44 failures
  "Birch Betula spp.",
  "Solid Of bamboo or with at least the top layer wear layer of bamboo Builders joinery and carpentry of wood",
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

    console.log(`\n=== "${q.slice(0,80)}" ===`);
    if (allowChRules.length) {
      for (const r of allowChRules)
        console.log(`  ALLOW ${r.id}: [${r.whitelist?.allowChapters?.join(',')}]`);
    } else {
      console.log(`  (no allowChapters restrictions)`);
    }
    for (const r of denyChRules)
      console.log(`  DENY  ${r.id}: [${r.whitelist?.denyChapters?.join(',')}]`);
    if (allowSet.size > 0 && surviving.length === 0) console.log(`  *** EMPTY ***`);
    else if (allowSet.size > 0) console.log(`  Surviving: [${surviving.join(',')}]`);
    else console.log(`  (no chapter restrictions — open)`);
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
