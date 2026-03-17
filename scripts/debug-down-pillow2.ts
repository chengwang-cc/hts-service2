#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(IntentRuleService, { strict: false });
  const rules = (svc as any).getAllRules() as any[];
  
  const r = rules.find((x: any) => x.id === 'GARMENT_DENY_COTTON_PULP');
  if (r) {
    console.log('GARMENT_DENY_COTTON_PULP:');
    console.log('  pattern:', JSON.stringify(r.pattern));
    console.log('  whitelist:', JSON.stringify(r.whitelist));
  }
  await app.close();
}
main().catch((e: Error) => { console.error(e.message); process.exit(1); });
