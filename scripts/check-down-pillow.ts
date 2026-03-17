#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(IntentRuleService, { strict: false });
  const rules = (svc as any).getAllRules();
  for (const testQuery of ['down pillow', 'sleeping pillow']) {
    const testTokens = new Set(testQuery.split(' '));
    const fired: string[] = [];
    for (const rule of rules) {
      const p: any = (rule as any).pattern || {};
      const anyOf: string[] = p.anyOf || [];
      let matches = false;
      for (const t of anyOf) {
        if (!t.includes(' ') && testTokens.has(t)) { matches = true; break; }
        if (t.includes(' ') && testQuery.includes(t)) { matches = true; break; }
      }
      if (matches && (rule as any).whitelist?.allowChapters?.length > 0) {
        fired.push((rule as any).id + '(' + (rule as any).whitelist.allowChapters.join(',') + ')');
      }
    }
    console.log('[' + testQuery + '] rulesWithAllow:', fired.join(', ') || 'NONE');
  }
  await app.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
