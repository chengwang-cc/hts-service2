import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();

  // 1. Check FRESH_VEGETABLE_INTENT
  for (const id of ['FRESH_VEGETABLE_INTENT', 'FRESH_FRUIT_INTENT', 'DEVICE_CASE_INTENT', 'ESSENTIAL_OIL_INTENT', 'PET_FOOD_INTENT']) {
    const r = allRules.find(r => r.id === id);
    if (r) console.log('\n' + id + ':\n' + JSON.stringify({ pattern: r.pattern, whitelist: r.whitelist }, null, 2));
    else console.log(id + ': NOT FOUND');
  }

  // 2. Find rules with empty anyOf
  const emptyAnyOf = allRules.filter(r => !r.pattern?.anyOf || r.pattern.anyOf.length === 0);
  console.log(`\n=== Rules with empty/null anyOf (${emptyAnyOf.length}) ===`);
  for (const r of emptyAnyOf) {
    console.log(`  ${r.id}: whitelist=${JSON.stringify(r.whitelist)}`);
  }

  await app.close();
}
main().catch(console.error);
