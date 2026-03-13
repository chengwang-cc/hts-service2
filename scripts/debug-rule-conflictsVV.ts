#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  // Verify SS fixes
  "Articles for use in civil aircraft with a basis of mineral substances Other Friction materials",
  "Film strip and sheets not over 0.076 mm in thickness Of other cellulose derivatives",
  "Of the genus Pimenta including allspice Dried neither crushed nor ground",
  "In airtight containers and not containing apricots citrus fruits peaches or pears",
  "Hibachis Other including appliances for solid fuel",
  "Tapestry fabrics and upholstery fabrics of a weight not exceeding 140 g/m2 Other",
  // Verify RR fixes still holding
  "Other Other Medicaments excluding goods of heading 3002 3005 or 3006 consisting of two or more constituents which have been mixed together for therapeutic or prophylactic uses",
  "Used or rebuilt Other numerically controlled bending folding straightening or flattening machines",
  // MEDICAMENT_CH30_INTENT check
  "Antiprotozoals excluding goods described in subheading note 2 to this chapter Other Medicaments",
  // Check potential side effects of SPICE_NONE_OF additions
  "Smoked salmon fillets",
  "Dried fish mackerel", 
  "Salted pork belly",
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
    else console.log(`  (no chapter restrictions — open)`);
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
