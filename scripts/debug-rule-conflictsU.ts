#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  // Verify NN fix 1: medical sterilizers (should be open now, not [06])
  "Medical surgical or laboratory sterilizers Machinery plant or laboratory equipment whether or not electrically heated",
  // Verify NN fix 2: olive pomace oil (should be open, not [23])
  "Other Crude olive pomace oil",
  // Verify NN fix 3: animal vegetable fats (should be open, not [07,35])
  "Other Animal vegetable or microbial fats and oils and their fractions boiled oxidized dehydrated sulfurized blown polymerized by heat in vacuum or in inert gas or otherwise chemically modified",
  // Verify NN fix 5: silica sands (should be open, not [71])
  "Sand containing by weight 95 percent or more of silica and not more than 0.6 percent of oxide of iron Silica sands and quartz sands",
  // Verify NN fix 5: quartz quartzite (should be open, not [71])
  "Quartz Quartz other than natural sands quartzite whether or not roughly trimmed or merely cut by sawing or otherwise into blocks or slabs",
  // Make sure pomace (animal feed residue) still fires for ANIMAL_FEED_CH23
  "Grape pomace wine dregs",
  // Make sure fresh vegetables still fire FRESH_VEGETABLE_INTENT
  "Fresh broccoli carrots spinach",
  // Make sure INDOOR_PLANT_INTENT still fires for actual plants
  "Succulent houseplant bonsai seedling",
  // Make sure CRYSTAL_GEMSTONE_INTENT still fires for actual crystals
  "Rose quartz crystal sphere amethyst gemstone",
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
