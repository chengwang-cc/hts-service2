#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(IntentRuleService, { strict: false });
  const rules = (svc as any).getAllRules() as any[];
  
  const testQuery = 'down pillow';
  const testTokens = new Set(testQuery.split(' '));
  
  for (const rule of rules) {
    const p: any = rule.pattern || {};
    const anyOf: string[] = p.anyOf || [];
    let matches = false;
    for (const t of anyOf) {
      if (!t.includes(' ') && testTokens.has(t)) { matches = true; break; }
      if (t.includes(' ') && testQuery.includes(t)) { matches = true; break; }
    }
    if (matches && rule.whitelist) {
      console.log(`${rule.id}: whitelist=${JSON.stringify(rule.whitelist)}`);
    }
  }
  await app.close();
}
main().catch((e: Error) => { console.error(e.message); process.exit(1); });
