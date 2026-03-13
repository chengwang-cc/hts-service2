#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();

  const TARGETS = [
    'FRESH_VEGETABLE_INTENT', 'FRESH_FRUIT_INTENT', 'AI_CH14_PLAITING_MATERIALS',
    'AI_CH88_AIRPLANE', 'AI_CH56_TWINE_BALER', 'MEAT_POULTRY_INTENT',
    'SHOVEL_RAKE_GARDEN_INTENT', 'CLOCK_TIMEPIECE_INTENT', 'AI_CH22_SPIRITS_WHISKEY',
    'AI_CH57_KILIM_FLATWEAVE_RUG', 'AI_CH89_MOTORBOAT', 'AI_CH92_VIOLIN_BOW',
    'AI_CH89_DREDGER_PLATFORM', 'WOOD_CRAFT_DENY_FOOTWEAR',
  ];
  for (const id of TARGETS) {
    const r = allRules.find(x => x.id === id);
    if (!r) { console.log(`NOT FOUND: ${id}`); continue; }
    console.log(`\n=== ${r.id} ===`);
    console.log(JSON.stringify({ pattern: r.pattern, whitelist: r.whitelist }, null, 2));
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
