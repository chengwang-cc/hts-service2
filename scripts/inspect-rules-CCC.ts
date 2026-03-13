import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();
  for (const id of ['SEED_FOR_SOWING_INTENT','FRESH_VEGETABLE_INTENT','FOOTWEAR_INTENT','AI_CH64_ESPADRILLE','AI_CH64_HIGH_HEELS']) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = allRules.find((x: any) => x.id === id);
    if (r) console.log('\n' + id + ':\n' + JSON.stringify({ pattern: r.pattern, whitelist: r.whitelist, inject: r.inject }, null, 2));
    else console.log('\n' + id + ': NOT FOUND');
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
