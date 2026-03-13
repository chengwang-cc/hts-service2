#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  // Verify QQ fixes
  "Of potassium Other Phosphinates hypophosphites phosphonates phosphites and phosphates polyphosphates whether or not chemically defined",
  "D-Arabinose Sugars chemically pure other than sucrose lactose maltose glucose and fructose sugar ethers sugar acetals and sugar esters",
  "Other Other Hormones prostaglandins thromboxanes and leukotrienes natural or reproduced by synthesis derivatives and structural analogues thereof including chain modified polypeptides",
  "By plaster cement ceramics or glass deposit",
  // ch.16 crustaceans → ch.03 (ranking issue)
  "Other Other Other crustaceans",
  // ch.26 vanadium → ch.81 (ranking issue)
  "Containing mainly vanadium Other",
  // ch.61 cross-chapter: knitted vs woven garments
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
    const isEmpty = allowSet.size > 0 && surviving.length === 0;

    console.log(`\n=== "${q.slice(0,90)}" ===`);
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
