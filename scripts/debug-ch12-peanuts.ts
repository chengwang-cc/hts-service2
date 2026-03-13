import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

// Check specific queries with rule details
const QUERIES = [
  "Other Other In shell",  // expected 1202.41 peanuts in shell, got ch.93 (ammunition)
];

function tokenize(query: string): Set<string> {
  const stop = new Set(['a','an','the','for','and','with','to','of','in','on','by','or','at','is','it','its','nor','other','than','from','not','as','be','if','no','so','do','up','use']);
  return new Set((query.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => !stop.has(t) && t.length > 1));
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();
  
  // Show ch.93 rules
  console.log('=== Rules with allowChapters:[93] ===');
  const ch93Rules = allRules.filter(r => r.whitelist?.allowChapters?.includes('93'));
  for (const r of ch93Rules) console.log(`  ${r.id}: anyOf=${JSON.stringify(r.pattern?.anyOf?.slice(0,5))}`);

  for (const q of QUERIES) {
    const tokens = tokenize(q);
    const qLower = q.toLowerCase();
    const matched = allRules.filter(r => r.pattern && patternMatches(r.pattern, tokens, qLower));
    const allowChRules = matched.filter(r => r.whitelist?.allowChapters?.length);
    const denyChRules = matched.filter(r => r.whitelist?.denyChapters?.length);
    const allowSet = new Set(allowChRules.flatMap(r => r.whitelist?.allowChapters ?? []));
    const denySet = new Set(denyChRules.flatMap(r => r.whitelist?.denyChapters ?? []));
    const surviving = [...allowSet].filter(ch => !denySet.has(ch));
    console.log(`\n=== "${q}" ===`);
    console.log(`  tokens: [${[...tokens].join(', ')}]`);
    if (allowChRules.length) for (const r of allowChRules) console.log(`  ALLOW ${r.id}: [${r.whitelist?.allowChapters?.join(',')}]`);
    else console.log(`  (open)`);
    for (const r of denyChRules) console.log(`  DENY  ${r.id}: [${r.whitelist?.denyChapters?.join(',')}]`);
    if (allowSet.size > 0 && surviving.length === 0) console.log(`  *** EMPTY ***`);
    else if (allowSet.size > 0) console.log(`  Surviving: [${surviving.join(',')}]`);
    else console.log(`  (open)`);
  }
  await app.close();
}
main().catch(console.error);
