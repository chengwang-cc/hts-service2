import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tireRules = allRules.filter((r: any) => JSON.stringify(r).toLowerCase().includes('tire') || JSON.stringify(r).toLowerCase().includes('tyre') || r.id.includes('TIRE') || r.id.includes('RUBBER'));
  for (const r of tireRules) {
    console.log('\n' + r.id + ':\n' + JSON.stringify({ pattern: r.pattern, whitelist: r.whitelist, inject: r.inject }, null, 2));
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
