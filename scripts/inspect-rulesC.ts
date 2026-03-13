#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const RULE_IDS = [
  'UMBRELLA_INTENT',
  'AI_CH66_WALKING_STICK',
  'AI_CH51_RAW_WOOL',
  'AI_CH51_WOOL_FABRIC_GENERIC',
  'FLOUR_GRAIN_INTENT',
  'AI_CH36_EXPLOSIVES',
  'NUTS_SEEDS_INTENT',
  'FRESH_VEGETABLE_INTENT',
  'AI_CH47_WOODPULP',
  'AI_CH03_MOLLUSCS',
  'AI_CH03_FISH_MEAL_FLOUR',
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
