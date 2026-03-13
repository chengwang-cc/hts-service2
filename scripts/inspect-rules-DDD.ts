import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();
  for (const id of [
    'AI_CH40_RETREADED_TIRES', 'AI_CH40_RETREADED_USED_TIRES',
    'REFRACTORY_CLAY_CEMENT_INTENT', 'CIGARETTE_LEAF_TOBACCO_INTENT', 'BEEF_AIRTIGHT_SAUSAGE_INTENT',
    'BIRCH_BETULA_VENEER_INTENT', 'SWIETENIA_MAHOGANY_TIMBER_INTENT',
    'PROTECTIVE_FOOTWEAR_ANKLE_INTENT', 'VEGETABLE_FIBER_UPPERS_FOOTWEAR_INTENT',
  ]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = allRules.find((x: any) => x.id === id);
    if (r) console.log('\n' + id + ':\n' + JSON.stringify({ pattern: r.pattern, whitelist: r.whitelist, inject: r.inject }, null, 2));
    else console.log('\n' + id + ': NOT FOUND');
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
