#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();
  const ids = ['AI_CH40_CONDOM', 'AI_CH66_TELESCOPIC_UMBRELLA'];
  for (const id of ids) {
    const r = allRules.find(r => r.id === id);
    if (r) console.log(id + ':', JSON.stringify({ pattern: r.pattern, whitelist: r.whitelist }, null, 2));
    else console.log(id + ': NOT FOUND');
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
