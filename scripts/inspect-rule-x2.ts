#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const EVAL_PATH = path.resolve(__dirname, '../docs/evaluation/lookup-evaluation-set-v1.jsonl');
const STOP = new Set(['a','an','the','for','and','with','to','of','in','on','by','or','at','is','it','its','nor','other','than','from','not','as','be','if','no','so','do','up','use']);

function tokenize(q: string): Set<string> {
  return new Set((q.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => !STOP.has(t) && t.length > 1));
}
function matches(term: string, tokens: Set<string>, lower: string): boolean {
  return term.includes(' ') ? lower.includes(term) : tokens.has(term);
}
function ruleMatches(rule: any, q: string): boolean {
  const p = rule.pattern ?? {};
  const tokens = tokenize(q);
  const lower = q.toLowerCase();
  const noneOf: string[] = p.noneOf ?? [];
  if (noneOf.some((t: string) => matches(t, tokens, lower))) return false;
  const anyOf: string[] = p.anyOf ?? [];
  const anyOfGroups: string[][] = p.anyOfGroups ?? [];
  const required: string[] = p.required ?? [];
  const hasAnyOf = anyOf.length === 0 || anyOf.some((t: string) => matches(t, tokens, lower));
  const hasGroups = anyOfGroups.length === 0 || anyOfGroups.every((g: string[]) => g.some((t: string) => matches(t, tokens, lower)));
  const hasRequired = required.every((t: string) => matches(t, tokens, lower));
  return hasAnyOf && hasGroups && hasRequired;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });
    const allRules = svc.getAllRules() as any[];

    const lines = fs.readFileSync(EVAL_PATH, 'utf-8').split('\n');
    const entries: any[] = [];
    for (const line of lines) {
      if (!line.trim() || line.startsWith('#')) continue;
      try { entries.push(JSON.parse(line)); } catch {}
    }

    const targetRules = [
      'THREAD_EMBROIDERY_CORD_INTENT',
      'AI_CH60_DOUBLE_KNIT_INTERLOCK',
      'GLASSWARE_DRINKING_INTENT',
      'JEWELRY_EARRING_INTENT',
      'LACE_VELVET_FABRIC_INTENT',
      'AI_CH64_GAITER_LEGGING',
      'AI_CH64_HEEL_CUSHION_PARTS',
      'INLINE_SKATE_SPORTS_INTENT',
      'AI_CH03_MAHI_SNAPPER_GROUPER',
      'AI_CH58_BRAID_TASSEL_TRIM',
      'HAIR_CLAW_INTENT',
      'SPORTS_JERSEY_INTENT',
      'SPORTS_JERSEY_GARMENT_INTENT',
      'SHIRT_GARMENT_BACKUP_INTENT',
      'TEMPERED_GLASS_SCREEN_INTENT',
    ];

    for (const ruleId of targetRules) {
      const rule = allRules.find(r => r.id === ruleId);
      if (!rule) { console.log(`\n=== ${ruleId} NOT FOUND ===`); continue; }
      console.log(`\n=== ${ruleId} ===`);
      console.log(`anyOf (${(rule.pattern?.anyOf??[]).length}): ${JSON.stringify((rule.pattern?.anyOf??[]).slice(0,10))}`);
      console.log(`noneOf (${(rule.pattern?.noneOf??[]).length}): first5=${JSON.stringify((rule.pattern?.noneOf??[]).slice(0,5))}`);
      console.log(`allowChapters: ${JSON.stringify(rule.whitelist?.allowChapters)}`);

      const blocked: string[] = [];
      for (const entry of entries.slice(0, 5000)) {
        const q: string = entry.query ?? '';
        const expectedHts: string = entry.htsno ?? '';
        const expectedCh = parseInt(expectedHts.substring(0, 2), 10);
        const allowedChs: number[] = rule.whitelist?.allowChapters ?? [];
        if (allowedChs.includes(expectedCh)) continue;
        if (!ruleMatches(rule, q)) continue;
        const tokens = tokenize(q);
        const lower = q.toLowerCase();
        const triggered = (rule.pattern?.anyOf ?? []).filter((t: string) => matches(t, tokens, lower));
        blocked.push(`  [ch.${isNaN(expectedCh) ? 'NaN' : String(expectedCh).padStart(2,'0')}] "${q}" → ${expectedHts}\n    trigger: ${JSON.stringify(triggered)}`);
      }
      console.log(`Blocked: ${blocked.length}`);
      blocked.slice(0, 8).forEach(b => console.log(b));
      if (blocked.length > 8) console.log(`  ... and ${blocked.length - 8} more`);
    }
  } finally {
    await app.close();
  }
}

main().catch(console.error);
