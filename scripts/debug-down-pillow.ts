#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(IntentRuleService, { strict: false });
  const rules = (svc as any).getAllRules() as any[];
  
  const r = rules.find((x: any) => x.id === 'PILLOW_BEDDING_INTENT');
  if (r) {
    console.log('PILLOW_BEDDING_INTENT pattern:', JSON.stringify(r.pattern));
    console.log('PILLOW_BEDDING_INTENT whitelist:', JSON.stringify(r.whitelist));
    console.log('PILLOW_BEDDING_INTENT inject:', JSON.stringify(r.inject));
    console.log('PILLOW_BEDDING_INTENT boosts:', JSON.stringify(r.boosts));
  }
  
  const testQuery = 'down pillow';
  const testTokens = new Set(testQuery.split(' '));
  const fired: string[] = [];
  for (const rule of rules) {
    const p: any = rule.pattern || {};
    const anyOf: string[] = p.anyOf || [];
    let matches = false;
    for (const t of anyOf) {
      if (!t.includes(' ') && testTokens.has(t)) { matches = true; break; }
      if (t.includes(' ') && testQuery.includes(t)) { matches = true; break; }
    }
    if (matches) fired.push(rule.id);
  }
  console.log('\nRules firing for [down pillow]:', fired.join(', '));
  await app.close();
}
main().catch((e: Error) => { console.error(e.message); process.exit(1); });
