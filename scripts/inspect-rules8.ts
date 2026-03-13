#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const RULE_IDS = [
  'CEMENT_CONCRETE_INTENT',
  'AI_CH40_PNEUMATIC_TIRES',
  'AI_CH40_RUBBER_TIRES',
  'AI_CH40_RUBBER_TIRES_PASSENGER',
  'AI_CH51_RAW_WOOL',
  'BANDAGE_FIRST_AID_INTENT',
  'AI_CH67_FEATHER_ARTICLES',
  'AI_CH31_ORGANIC_ANIMAL_FERTILIZER',
  'AI_CH36_METALDEHYDE',
  'AI_CH13_VEGETABLE_EXTRACTS',
  'AI_CH03_MOLLUSCS',
  'AI_CH89_FERRY_CARGO_VESSEL',
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
