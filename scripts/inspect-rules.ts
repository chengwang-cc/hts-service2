#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();

  const TARGETS = ['AI_CH92_XYLOPHONE_MARIMBA', 'AI_CH92_BAGPIPES', 'AI_CH91_WATCH_PARTS_DIAL', 'SEAFOOD_FISH_INTENT'];
  for (const id of TARGETS) {
    const r = allRules.find(x => x.id === id);
    if (!r) { console.log(`NOT FOUND: ${id}`); continue; }
    console.log(`\n=== ${r.id} ===`);
    console.log(JSON.stringify({ description: r.description, pattern: r.pattern, whitelist: r.whitelist }, null, 2));
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
