#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const QUERIES = [
  // ch.62 garments made from 5903/5906/5907 fabrics → ch.59
  "Having an outer surface impregnated coated covered or laminated with rubber or plastics material which completely obscures the underlying fabric Other men s or boys garments Garments made up of fabrics of heading 5602 5603 5903 5906 or 5907",
  "Having an outer surface impregnated coated covered or laminated with rubber or plastics material which completely obscures the underlying fabric Garments made up of knitted or crocheted fabrics of heading 5903 5906 or 5907",
  // ch.54 woven synthetic filament → ch.47 or ch.51
  "Weighing more than 170 g/m Unbleached or bleached",
  "Poplin or broadcloth Other Of yarns of different colors",
  // ch.52 cotton → ch.51
  "Sheeting Other Bleached",
  "Poplin or broadcloth Of numbers 43 to 68 Plain weave weighing not more than 100 g/m",
  // ch.44 plywood → ch.47
  "Not surface covered Other Other with at least one outer ply of nonconiferous wood not specified under subheading 4412.33",
  // ch.72 steel sections
  "Other Hot-rolled not drilled not punched and not otherwise advanced Angles shapes and sections",
  // ch.38 clay → ch.25
  "Clay",
  // ch.41 leather parings → ch.11
  "Parings and other waste of leather or of composition leather not suitable for the manufacture of leather articles leather dust powder and flour",
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
