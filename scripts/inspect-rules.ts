import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: [] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });
    const allRules = svc.getAllRules() as any[];
    const ids = ['SILICONE_CRAFT_MOLD_INTENT', 'WOOL_YARN_FIBER_INTENT'];
    for (const id of ids) {
      const rule = allRules.find((r: any) => r.id === id);
      if (rule) {
        console.log(`\n${id}:`);
        console.log('  whitelist:', JSON.stringify(rule.whitelist));
        console.log('  inject:', JSON.stringify(rule.inject?.slice(0,4)));
        console.log('  anyOf[:5]:', JSON.stringify(rule.pattern?.anyOf?.slice(0,5)));
        console.log('  noneOf:', JSON.stringify(rule.pattern?.noneOf));
        console.log('  priority:', rule.priority);
      } else {
        console.log(`${id}: NOT FOUND`);
      }
    }
  } finally {
    await app.close();
  }
}
run().catch(console.error);
