#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const RULE_IDS = [
  'AI_CH91_POCKET_WATCH',
  'AI_CH31_POTASSIUM_FERTILIZER',
  'AI_CH17_GLUCOSE_SYRUP',
  'AI_CH17_FRUCTOSE',
  'AI_CH17_LACTOSE_MALTOSE',
  'BANDAGE_FIRST_AID_INTENT',
  'CEMENT_CONCRETE_INTENT',
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
