import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();
  const r = allRules.find((x: any) => x.id === 'BEE_KEEPING_MACHINERY_PARTS_INTENT');
  if (r) console.log(JSON.stringify({ inject: r.inject, boosts: r.boosts, pattern: r.pattern }, null, 2));
  else console.log('NOT FOUND');
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
