#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false }) as any;
  const rules: any[] = svc.getAllRules();

  const CHECK = [
    'COFFEE_BEAN_INTENT', 'COFFEE_SINGLE_ORIGIN_INTENT',
    'JEWELRY_RING_INTENT', 'WINE_INTENT', 'AI_CH09_VANILLA',
    'CHOCOLATE_FOOD_INTENT', 'DAIRY_INTENT', 'STICKER_SHEET_PAPER_INTENT',
    'AI_CH92_DRUM_STAND_ACCESSORY', 'AI_CH36_FIREWORKS',
    'OUTERWEAR_JACKET_GARMENT_INTENT', 'PEN_PENCIL_INTENT',
    'INCENSE_AROMATHERAPY_INTENT', 'FRESH_FRUIT_INTENT',
    'QUARTZ_CRYSTAL_CARVED_INTENT', 'GEMSTONE_CRYSTAL_MINERAL_INTENT',
  ];

  for (const id of CHECK) {
    const rule = rules.find((r: any) => r.id === id);
    if (!rule) { console.log(`${id}: NOT FOUND`); continue; }
    const p = rule.pattern ?? {};
    const wl = rule.whitelist;
    console.log(`\n${id}:`);
    console.log(`  allowChapters: ${JSON.stringify(wl?.allowChapters ?? 'NONE')}`);
    if (p.anyOf?.length) console.log(`  anyOf: ${JSON.stringify(p.anyOf.slice(0, 5))}... (${p.anyOf.length})`);
    if (p.anyOfGroups?.length) console.log(`  anyOfGroups: ${JSON.stringify(p.anyOfGroups.slice(0, 2))}... (${p.anyOfGroups.length} groups)`);
    if (p.noneOf?.length) console.log(`  noneOf (${p.noneOf.length}): ${JSON.stringify(p.noneOf.slice(0, 5))}...`);
    if (p.required?.length) console.log(`  required: ${JSON.stringify(p.required)}`);
  }

  await app.close();
}

main().catch(err => { console.error(err); process.exit(1); });
