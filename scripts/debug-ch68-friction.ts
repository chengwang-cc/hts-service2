import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { patternMatches } from '../src/modules/lookup/services/intent-rules';

const Q = "Articles for use in civil aircraft with a basis of mineral substances Other Friction material and articles thereof for example sheets rolls strips segments discs washers pads not mounted for brakes for clutches or the like with a basis of asbestos of other mineral substances or of cellulose whether or not combined with textile or other materials";

function tokenize(query: string): Set<string> {
  const stop = new Set(['a','an','the','for','and','with','to','of','in','on','by','or','at','is','it','its','nor','other','than','from','not','as','be','if','no','so','do','up','use']);
  return new Set((query.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => !stop.has(t) && t.length > 1));
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const tokens = tokenize(Q);
  const qLower = Q.toLowerCase();
  console.log('Tokens (first 20):', [...tokens].slice(0,20).join(', '));
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
