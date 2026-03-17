#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false }) as any;
  const rules = svc.getAllRules();
  const rule = rules.find((r: any) => r.id === 'ARTIFICIAL_FLOWER_DECOR_INTENT');
  if (rule) {
    console.log('ARTIFICIAL_FLOWER_DECOR_INTENT:');
    console.log('  allowChapters:', rule.whitelist?.allowChapters ?? 'NONE (no restriction)');
    console.log('  anyOf sample:', (rule.pattern?.anyOf ?? []).slice(0, 5).join(', '));
  } else {
    console.log('Rule NOT FOUND');
  }
  const whiskey = rules.find((r: any) => r.id === 'AI_CH22_SPIRITS_WHISKEY');
  if (whiskey) {
    console.log('\nAI_CH22_SPIRITS_WHISKEY noneOf:', (whiskey.pattern?.noneOf ?? []).slice(0, 10).join(', '));
  }
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
