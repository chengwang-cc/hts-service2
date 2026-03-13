import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();

  const ids = ['SCREW_BOLT_INTENT', 'AI_CH02_SALTED_CURED_MEAT', 'AI_CH14_PLAITING_MATERIALS', 'MUSICAL_INSTRUMENT_INTENT'];
  for (const id of ids) {
    const r = allRules.find(r => r.id === id);
    if (r) console.log('\n' + id + ':\n' + JSON.stringify({ pattern: r.pattern, whitelist: r.whitelist }, null, 2));
    else console.log('\n' + id + ': NOT FOUND');
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
