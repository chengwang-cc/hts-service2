#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  // New EMPTY: medical surgical sterilizers (ch.84)
  "Medical surgical or laboratory sterilizers Machinery plant or laboratory equipment whether or not electrically heated excluding furnaces ovens and other equipment of heading 8514 for the treatment of materials by a process involving a change of temperature such as heating cooking roasting distilling rectifying sterilizing pasteurizing steaming drying evaporating vaporizing condensing or cooling other than machinery or plant of a kind used for domestic purposes instantaneous or storage water heaters nonelectric parts thereof",
  // In shell → ch.93 (was EMPTY, now wrong chapter)
  "Other Other In shell",
  // New EMPTY: crude olive pomace oil (ch.15)
  "Other Crude olive pomace oil",
  // New cross-chapter: animal fats → ch.85 (expected ch.15)
  "Other Animal vegetable or microbial fats and oils and their fractions boiled oxidized dehydrated sulfurized blown polymerized by heat in vacuum or in inert gas or otherwise chemically modified excluding those of heading 1516 inedible mixtures or preparations of animal vegetable or microbial fats or oils or of fractions of different fats or oils of this chapter not elsewhere specified or included",
  // New cross-chapter: silica sands → ch.71 (expected ch.25)
  "Sand containing by weight 95 percent or more of silica and not more than 0.6 percent of oxide of iron Silica sands and quartz sands Natural sands of all kinds whether or not colored other than metalbearing sands of chapter 26",
  // New cross-chapter: quartz → ch.71 (expected ch.25)
  "Quartz Quartz other than natural sands quartzite whether or not roughly trimmed or merely cut by sawing or otherwise into blocks or slabs of a rectangular including square shape",
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
