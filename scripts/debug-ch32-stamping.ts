import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const Q = "Stamping foils Pigments including metallic powders and flakes dispersed in nonaqueous media in liquid or paste form of a kind used in the manufacture of paints including enamels stamping foils dyes and other coloring matter put up in forms or packings for retail sale";

function tokenize(query: string): Set<string> {
  const stop = new Set(['a','an','the','for','and','with','to','of','in','on','by','or','at','is','it','its','nor','other','than','from','not','as','be','if','no','so','do','up','use']);
  return new Set((query.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => !stop.has(t) && t.length > 1));
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const tokens = tokenize(Q);
  const qLower = Q.toLowerCase();
  console.log('Tokens:', [...tokens].join(', '));
  const allRules = svc.getAllRules();
  const matched = allRules.filter(r => r.pattern && patternMatches(r.pattern, tokens, qLower));
  const allowChRules = matched.filter(r => r.whitelist?.allowChapters?.length);
  const denyChRules = matched.filter(r => r.whitelist?.denyChapters?.length);
  const allowSet = new Set(allowChRules.flatMap(r => r.whitelist?.allowChapters ?? []));
  const denySet = new Set(denyChRules.flatMap(r => r.whitelist?.denyChapters ?? []));
  const surviving = [...allowSet].filter(ch => !denySet.has(ch));
  for (const r of allowChRules) console.log(`ALLOW ${r.id}: [${r.whitelist?.allowChapters?.join(',')}]`);
  for (const r of denyChRules) console.log(`DENY  ${r.id}: [${r.whitelist?.denyChapters?.join(',')}]`);
  console.log(`Surviving: [${surviving.join(',')}]`);
  if (allowSet.size > 0 && surviving.length === 0) console.log('*** EMPTY ***');
  else if (allowSet.size === 0) console.log('(open)');
  await app.close();
}
main().catch(console.error);
