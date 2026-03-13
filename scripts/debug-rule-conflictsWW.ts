import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  // ch.26 → ch.81: vanadium slag vs vanadium metal
  "Containing mainly vanadium Other",
  // ch.44 plywood vs veneer: birch and mahogany
  "Birch Betula spp.",
  "Mahogany Swietenia spp.",
  "Other With a face ply of birch Betula spp.",
  // ch.40 used tires
  "Other Used pneumatic tires",
  "Other Other Retreaded or used pneumatic tires of rubber solid or cushion tires",
  // ch.38 clay vs ch.25
  "Clay",
  // ch.16 crustaceans → ch.03 (check if any rule now fires)
  "Other Other Other crustaceans",
  // ch.61 vs ch.62 (check for any new rule activity)
  "Men s or boys Other Of other textile materials",
  "Shirts Of artificial fibers",
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
    console.log(`\n=== "${q.slice(0,70)}" ===`);
    if (allowChRules.length) for (const r of allowChRules) console.log(`  ALLOW ${r.id}: [${r.whitelist?.allowChapters?.join(',')}]`);
    else console.log(`  (no allowChapters restrictions)`);
    for (const r of denyChRules) console.log(`  DENY  ${r.id}: [${r.whitelist?.denyChapters?.join(',')}]`);
    if (allowSet.size > 0 && surviving.length === 0) console.log(`  *** EMPTY ***`);
    else if (allowSet.size > 0) console.log(`  Surviving: [${surviving.join(',')}]`);
    else console.log(`  (open)`);
  }
  await app.close();
}
main().catch(console.error);
