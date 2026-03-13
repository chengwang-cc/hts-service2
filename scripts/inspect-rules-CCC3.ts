import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();
  for (const id of ['PLYWOOD_LUMBER_INTENT','AI_CH44_BIRCH_PLYWOOD','AI_CH44_VENEER','AI_CH44_SAWN_TIMBER']) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = allRules.find((x: any) => x.id === id);
    if (r) console.log('\n' + id + ':\n' + JSON.stringify({ pattern: r.pattern, whitelist: r.whitelist, inject: r.inject }, null, 2));
    else console.log('\n' + id + ': NOT FOUND');
  }
  // Also show all ch.44 rules
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ch44 = allRules.filter((r: any) => r.whitelist?.allowChapters?.includes('44'));
  console.log('\n--- All ch44 allow rules ---');
  ch44.forEach((r: any) => console.log(r.id));
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
