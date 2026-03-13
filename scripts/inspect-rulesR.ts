import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();
  for (const id of ['AI_CH03_SMOKED_DRIED_SALTED_FISH','AI_CH02_SALTED_CURED_MEAT','IRON_STEEL_TUBE_PIPE_HTS_INTENT']) {
    const r = allRules.find(r => r.id === id);
    if (r) console.log('\n' + id + ':\n' + JSON.stringify({ pattern: r.pattern, whitelist: r.whitelist }, null, 2));
    else console.log('\n' + id + ': NOT FOUND');
  }
  await app.close();
}
main().catch(console.error);
