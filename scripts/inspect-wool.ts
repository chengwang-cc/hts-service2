import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: [] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });
    const allRules = svc.getAllRules() as any[];
    const rule = allRules.find((r: any) => r.id === 'WOOL_YARN_FIBER_INTENT');
    if (rule) {
      console.log('whitelist:', JSON.stringify(rule.whitelist));
      console.log('anyOfGroups:', JSON.stringify(rule.pattern?.anyOfGroups));
      console.log('anyOf (first 8):', JSON.stringify(rule.pattern?.anyOf?.slice(0,8)));
      console.log('noneOf (first 8):', JSON.stringify(rule.pattern?.noneOf?.slice(0,8)));
      console.log('inject:', JSON.stringify(rule.inject?.slice(0,6)));
      console.log('priority:', rule.priority);
    } else {
      console.log('WOOL_YARN_FIBER_INTENT: not found');
    }
  } finally {
    await app.close();
  }
}
run().catch(console.error);
