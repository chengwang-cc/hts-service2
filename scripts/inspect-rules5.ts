#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const RULE_IDS = [
  'MEAT_BEEF_INTENT',
  'AI_CH02_GAME_EXOTIC',
  'AI_CH02_HORSE_MEAT',
  'AI_CH03_MAHI_SNAPPER_GROUPER',
  'AI_CH67_HUMAN_HAIR_PREPARED',
  'MEAT_POULTRY_INTENT',
  'AI_CH92_WHISTLE_DECOY',
  'AI_CH67_WIGS_HAIRPIECES',
  'FRESH_VEGETABLE_INTENT',
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
