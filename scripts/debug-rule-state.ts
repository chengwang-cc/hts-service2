#!/usr/bin/env ts-node
/**
 * Debug script: Check current state of key rules in DB
 * Shows allowChapters, anyOf count, noneOf terms for important rules
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false }) as any;
  const rules = svc.getAllRules() as any[];

  const KEY_RULES = [
    'ARTIFICIAL_FLOWER_DECOR_INTENT',
    'FRESH_FLOWER_INTENT',
    'FRESH_FRUIT_INTENT',
    'AI_CH22_SPIRITS_WHISKEY',
    'AI_CH13_VEGETABLE_EXTRACTS',
    'DRINKING_GLASS_TABLEWARE_INTENT',
    'GLASS_DECANTER_VESSEL_INTENT',
  ];

  for (const id of KEY_RULES) {
    const rule = rules.find((r: any) => r.id === id);
    if (!rule) {
      console.log(`${id}: NOT FOUND`);
      continue;
    }
    const p = rule.pattern ?? {};
    const wl = rule.whitelist;
    const allowCh = wl?.allowChapters;
    console.log(`\n${id}:`);
    console.log(`  priority: ${rule.priority}`);
    console.log(`  allowChapters: ${allowCh ? JSON.stringify(allowCh) : 'NONE (no blocking)'}`);
    console.log(`  anyOf: ${p.anyOf?.length ?? 0} terms`);
    if (p.noneOf?.length) console.log(`  noneOf: ${p.noneOf.length} terms`);
    if (rule.inject?.length) console.log(`  inject: ${rule.inject.length} codes`);
    if (rule.boosts?.length) console.log(`  boosts: ${rule.boosts.map((b: any) => `${b.prefixMatch ?? b.chapterMatch}:+${b.delta}`).join(', ')}`);
  }

  // Show all rules with allowChapters
  const blocking = rules.filter((r: any) => r.whitelist?.allowChapters?.length);
  console.log(`\n\n=== ALL RULES WITH allowChapters (${blocking.length} total) ===`);
  for (const r of blocking.sort((a: any, b: any) => (a.id > b.id ? 1 : -1))) {
    console.log(`  ${r.id}: [${r.whitelist.allowChapters.join(',')}]`);
  }

  await app.close();
}

main().catch(err => { console.error(err); process.exit(1); });
