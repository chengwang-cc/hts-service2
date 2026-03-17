#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(IntentRuleService, { strict: false });
  const rules = svc.getAllRules() as any[];
  const target = rules.find(r => r.id === 'SILICONE_CRAFT_MOLD_INTENT');
  console.log(JSON.stringify(target, null, 2));
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
