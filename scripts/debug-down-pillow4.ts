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
  
  console.log('All rules firing for [down pillow] with their full details:');
  for (const rule of rules) {
    const p: any = rule.pattern || {};
    const anyOf: string[] = p.anyOf || [];
    let matches = false;
    for (const t of anyOf) {
      if (!t.includes(' ') && testTokens.has(t)) { matches = true; break; }
      if (t.includes(' ') && testQuery.includes(t)) { matches = true; break; }
    }
    if (matches) {
      console.log(`\n${rule.id}:`);
      console.log('  whitelist:', JSON.stringify(rule.whitelist));
      console.log('  boosts:', JSON.stringify(rule.boosts));
      console.log('  penalties:', JSON.stringify(rule.penalties));
    }
  }
  await app.close();
}
main().catch((e: Error) => { console.error(e.message); process.exit(1); });
