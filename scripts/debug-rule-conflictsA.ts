#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  // ch.38 → ch.08: coconut still wrong
  "Derived from coconut",
  // ch.87 → ch.25: mobile cranes going to cement
  "Other Mobile cranes Special purpose motor vehicles other than those principally designed for the transport of persons or goods for example wreckers mobile cranes fire fighting vehicles concrete mixers road sweepers spraying vehicles mobile workshops mobile radiological units",
  // ch.87 → ch.40: wheels with tires
  "Wheels with tires for off-the-highway use Other Parts",
  // ch.68 → ch.51: slag wool going to textile wool
  "Pipe coverings Slag wool rock wool and similar mineral wools including intermixtures thereof in bulk sheets or rolls",
  // ch.68 → ch.30: gypsum plaster going to pharmaceuticals
  "Of gypsum plaster",
  // ch.96 → ch.39: buttons still wrong
  "Of acrylic resin of polyester resin or of both such resins Of plastics not covered with textile material Buttons press-fasteners snap-fasteners and press-studs button molds and other parts of these articles button blanks",
  // ch.96 → ch.67: artists brushes going to feathers
  "Valued over 5 but not over 10 each Artists brushes writing brushes and similar brushes for the application of cosmetics Brooms brushes including brushes constituting parts of machines appliances or vehicles hand-operated mechanical floor sweepers not motorized mops and feather dusters prepared knots and tufts for broom or brush making paint pads and rollers squeegees other than roller squeegees",
  // ch.44 → ch.36: bamboo joinery going to matches
  "Solid Of bamboo or with at least the top layer wear layer of bamboo Builders joinery and carpentry of wood including cellular wood panels and assembled flooring panels shingles and shakes",
  // ch.44 → ch.13: wood in the rough going to plant extracts
  "Other Other of which the smallest cross-sectional dimension is 15 cm or more Wood in the rough whether or not stripped of bark or sap- wood or roughly squared",
  // ch.16: crustaceans and clams going to ch.03
  "Other Other Other crustaceans",
  "Razor clams Siliqua patula",
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
