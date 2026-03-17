#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(IntentRuleService, { strict: false });
  const rules = (svc as any).getAllRules() as any[];
  
  const r = rules.find((x: any) => x.id === 'LEATHER_FOLIO_CROSSBODY_BAG_INTENT');
  if (r) {
    const p: any = r.pattern || {};
    console.log('anyOf (first 20):', JSON.stringify((p.anyOf||[]).slice(0,20)));
    console.log('noneOf:', JSON.stringify(p.noneOf||[]));
  }
  
  for (const query of ['rocket pocket saddle bag', 'ladies bamboo rayon spandex dolman top', 'folding lingerie elastic']) {
    const tokens = new Set(query.toLowerCase().match(/[a-z0-9]+/g)?.filter((t: string) => t.length > 1) || []);
    const matched = (svc as any).matchRules(tokens, query);
    const withAllow = matched.filter((r: any) => r.whitelist?.allowChapters?.length > 0);
    console.log('\n[' + query + '] rulesWithAllow: ' + (withAllow.map((r: any) => r.id + '(' + r.whitelist?.allowChapters?.join(',') + ')').join(', ') || 'NONE'));
    console.log('  all matched: ' + matched.map((r: any) => r.id).join(', '));
  }
  await app.close();
}
main().catch((e: Error) => { console.error(e.message); process.exit(1); });
