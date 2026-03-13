import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();
  const ids = ['BEE_KEEPING_MACHINERY_PARTS_INTENT', 'NON_ALCOHOLIC_BEVERAGE_INTENT', 'TRUNKS_OUTER_SURFACE_PLASTICS_INTENT'];
  for (const id of ids) {
    const r = allRules.find((x: any) => x.id === id);
    if (r) console.log(id + ':\n' + JSON.stringify({ boosts: r.boosts, inject: r.inject, whitelist: r.whitelist }, null, 2));
    else console.log(id + ': NOT FOUND');
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
