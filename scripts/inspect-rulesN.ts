import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();
  const r = allRules.find(r => r.id === 'AI_CH03_FISH_MEAL_FLOUR');
  if (r) console.log(JSON.stringify({ pattern: r.pattern, whitelist: r.whitelist }, null, 2));
  else console.log('NOT FOUND');
  await app.close();
}
main().catch(console.error);
