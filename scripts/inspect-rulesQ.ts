import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();

  const ids = [
    'AI_CH64_HIGH_HEELS',
    'AI_CH15_CANOLA_RAPESEED_OIL',
    'AI_CH15_RAPESEED_OIL',
    'NAIL_RIVET_INTENT',
    'AI_CH47_RECOVERED_PAPER',
    'AI_CH45_CORK_RAW',
    'AI_CH24_TOBACCO_REFUSE',
    'AI_CH75_NICKEL_SCRAP',
    'CRAFT_KIT_INTENT',
    'AI_CH75_NICKEL_MESH_CLOTH',
    'AI_CH03_LIVE_FISH',
    'AI_CH35_CASEIN',
    'SEAFOOD_FISH_INTENT',
    'PLYWOOD_LUMBER_INTENT',
    'SKI_SNOWBOARD_INTENT',
    'AI_CH22_SPIRITS_RUM',
    'AI_CH09_CLOVES',
    'CEMENT_CONCRETE_INTENT',
    'AI_CH75_NICKEL_TUBE_PIPE',
    'AI_CH75_NICKEL_BAR_ROD_WIRE',
    'FRESH_VEGETABLE_INTENT',
    'AI_CH09_CLOVES',
    'MEAT_BEEF_INTENT',
    'PREPARED_CANNED_MEATS_INTENT',
  ];

  for (const id of ids) {
    const r = allRules.find(r => r.id === id);
    if (r) console.log('\n' + id + ':\n' + JSON.stringify({ pattern: r.pattern, whitelist: r.whitelist }, null, 2));
    else console.log('\n' + id + ': NOT FOUND');
  }

  await app.close();
}
main().catch(console.error);
