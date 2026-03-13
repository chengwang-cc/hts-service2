#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const RULE_IDS = [
  'AI_CH56_FISHING_NET_HAMMOCK',
  'SKI_SNOWBOARD_INTENT',
  'AI_CH22_ETHYL_ALCOHOL',
  'AI_CH22_ETHYL_ALCOHOL_HIGH',
  'AI_CH31_PHOSPHATIC_FERTILIZER',
  'AI_CH58_RIBBON_TRIM',
  'AI_CH13_NATURAL_GUMS_RESINS',
  'AI_CH59_COATED_FABRIC_PVC_PU',
  'AI_CH11_OAT_PRODUCTS',
  'AI_CH14_PLAITING_MATERIALS',
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
