#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const RULE_IDS = [
  'SCREW_BOLT_INTENT',
  'AI_CH36_SIGNAL_FLARES',
  'AI_CH36_EXPLOSIVES',
  'AI_CH66_TELESCOPIC_UMBRELLA',
  'AI_CH88_SPACECRAFT',
  'AI_CH31_DEF',
  'AI_CH54_RAYON_FABRIC',
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();
  for (const id of RULE_IDS) {
    const rule = allRules.find(r => r.id === id);
    if (!rule) { console.log(`\n${id}: NOT FOUND`); continue; }
    console.log(`\n${id}:`);
    console.log(JSON.stringify(rule.pattern, null, 2));
    console.log(`  whitelist: ${JSON.stringify(rule.whitelist)}`);
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
