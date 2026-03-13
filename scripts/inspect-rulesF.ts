#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const RULE_IDS = [
  'AI_CH89_ROWBOAT_PADDLEBOAT',
  'AI_CH89_PERSONAL_WATERCRAFT',
  'AI_CH51_RAW_WOOL',
  'SUGAR_INTENT',
  'NUTS_SEEDS_INTENT',
  'AI_CH02_HORSE_MEAT',
  'AI_CH03_FISH_MEAL_FLOUR',
  'AI_CH11_WHEAT_GLUTEN',
  'AI_CH11_SEMOLINA_GROATS',
  'FRESH_VEGETABLE_INTENT',
  'FRESH_FRUIT_INTENT',
  'SCREW_BOLT_INTENT',
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
