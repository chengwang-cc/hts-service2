#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function fix() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });
    const allRules = svc.getAllRules() as any[];

    // Fix 1: SPORTS_JERSEY_GARMENT_INTENT - add 'jersey'/'jerseys' to anyOf
    // anyOf + anyOfGroups both required (AND). anyOf only had phrases like "authentic jersey"
    // which fails when "Majestic" separates them. Add single tokens so anyOf can match.
    const r = allRules.find(r => r.id === 'SPORTS_JERSEY_GARMENT_INTENT');
    if (!r) { console.log('NOT FOUND: SPORTS_JERSEY_GARMENT_INTENT'); }
    else {
      const pat = r.pattern as any;
      const currentAnyOf: string[] = pat.anyOf ?? [];
      const newAnyOf = [...currentAnyOf];
      if (!newAnyOf.includes('jersey')) newAnyOf.push('jersey');
      if (!newAnyOf.includes('jerseys')) newAnyOf.push('jerseys');
      await (svc as any).upsertRule({ ...r, pattern: { ...pat, anyOf: newAnyOf } }, 610, true);
      console.log('SPORTS_JERSEY_GARMENT_INTENT: added jersey/jerseys to anyOf');
    }

    // Fix 2: AI_CH60_DOUBLE_KNIT_INTERLOCK noneOf has uppercase 'MLB','NBA' etc.
    // Tokenizer lowercases everything, so uppercase terms never match.
    // Add lowercase equivalents to noneOf.
    const r2 = allRules.find(r => r.id === 'AI_CH60_DOUBLE_KNIT_INTERLOCK');
    if (!r2) { console.log('NOT FOUND: AI_CH60_DOUBLE_KNIT_INTERLOCK'); }
    else {
      const pat2 = r2.pattern as any;
      const noneOf2: string[] = pat2.noneOf ?? [];
      const toAdd = ['mlb', 'nba', 'nfl', 'nhl', 'mls', 'wnba'].filter(t => !noneOf2.includes(t));
      if (toAdd.length > 0) {
        await (svc as any).upsertRule(
          { ...r2, pattern: { ...pat2, noneOf: [...noneOf2, ...toAdd] } },
          500, true
        );
        console.log('AI_CH60_DOUBLE_KNIT_INTERLOCK: added lowercase league noneOf:', toAdd.join(', '));
      } else {
        console.log('AI_CH60_DOUBLE_KNIT_INTERLOCK: already has lowercase terms');
      }
    }

    await svc.reload();
    console.log('Done. Rules in cache:', svc.ruleCount);
  } finally {
    await app.close();
  }
}
fix().catch(e => { console.error('Fatal:', e); process.exit(1); });
