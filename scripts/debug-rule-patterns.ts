#!/usr/bin/env ts-node
/**
 * Check actual pattern content for specific rules
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false }) as any;
  const allRules: any[] = svc.getAllRules();

  const CHECK_RULES = ['ESSENTIAL_OIL_INTENT', 'PET_FOOD_INTENT', 'BABY_FOOD_INTENT', 'HAIR_CLIPPER_INTENT', 'AI_CH02_RIBS_SPARERIBS'];

  for (const id of CHECK_RULES) {
    const rule = allRules.find((r: any) => r.id === id);
    if (!rule) { console.log(`${id}: NOT FOUND`); continue; }
    const p = rule.pattern;
    console.log(`\n${id}:`);
    console.log(`  pattern keys: ${p ? Object.keys(p).join(', ') : 'NULL'}`);
    if (p?.anyOf !== undefined) console.log(`  anyOf (${p.anyOf?.length}): ${JSON.stringify(p.anyOf?.slice(0,3))}...`);
    else console.log(`  anyOf: UNDEFINED`);
    if (p?.required) console.log(`  required: ${JSON.stringify(p.required)}`);
    if (p?.noneOf) console.log(`  noneOf: ${p.noneOf.length} terms`);
  }

  // Count rules without anyOf
  const noAnyOf = allRules.filter(r => {
    const p = r.pattern;
    return !p || !p.anyOf || p.anyOf.length === 0;
  });
  console.log(`\nRules with no/empty anyOf: ${noAnyOf.length}`);
  const withAllow = noAnyOf.filter(r => r.whitelist?.allowChapters?.length);
  console.log(`Rules with no anyOf but WITH allowChapters: ${withAllow.length}`);
  for (const r of withAllow.slice(0, 20)) {
    console.log(`  ${r.id}: allowChapters=[${r.whitelist.allowChapters.join(',')}]`);
  }

  await app.close();
}

main().catch(err => { console.error(err); process.exit(1); });
