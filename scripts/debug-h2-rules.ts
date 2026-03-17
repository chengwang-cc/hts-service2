#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false }) as any;
  const rules = svc.getAllRules();

  // Find AI_CH13_VEGETABLE_EXTRACTS and AI_CH22_SPIRITS_WHISKEY
  for (const id of ['AI_CH13_VEGETABLE_EXTRACTS', 'AI_CH22_SPIRITS_WHISKEY', 'FRESH_FRUIT_INTENT', 'FRESH_FLOWER_INTENT']) {
    const rule = rules.find((r: any) => r.id === id);
    if (rule) {
      console.log(`\n${id}:`);
      console.log(`  allowChapters: [${rule.whitelist?.allowChapters?.join(',') ?? 'none'}]`);
      console.log(`  anyOf: [${(rule.pattern?.anyOf ?? []).join(', ')}]`);
      console.log(`  noneOf: [${(rule.pattern?.noneOf ?? []).join(', ')}]`);
    } else {
      console.log(`\n${id}: NOT FOUND`);
    }
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
