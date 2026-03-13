#!/usr/bin/env ts-node
/**
 * Debug cross-chapter failures — 2026-03-13 session WW+
 * Investigates specific failing queries to find fixable intent rule conflicts.
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  { q: 'Containing mainly vanadium Other', expectedCh: '26', gotCh: '81', note: 'vanadium slag vs metal' },
  { q: 'Clay', expectedCh: '38', gotCh: '25', note: 'refractory cement vs clay mineral' },
  { q: 'Other Other Other crustaceans', expectedCh: '16', gotCh: '03', note: 'prepared vs fresh crustaceans' },
  { q: 'Carrot', expectedCh: '12', gotCh: '07', note: 'carrot seed vs fresh vegetable' },
  { q: 'Tomato', expectedCh: '12', gotCh: '07', note: 'tomato seed vs fresh vegetable' },
  { q: 'Other Other In shell', expectedCh: '12', gotCh: '93', note: 'peanuts in shell vs ammunition' },
  { q: 'Of a thickness of less than 0.5 mm', expectedCh: '72', gotCh: '74', note: 'thin steel vs copper' },
  { q: 'Exceeding 2.2 kW but not exceeding 7.5 kW Other Other', expectedCh: '84', gotCh: '85', note: 'refrigerator part vs motor' },
  { q: 'Men s or boys Other Of other textile materials', expectedCh: '61', gotCh: '62', note: 'knitted t-shirts vs woven suits' },
  { q: 'Shirts Of artificial fibers', expectedCh: '61', gotCh: '62', note: 'knitted shirts vs woven' },
];

function tokenize(q: string): Set<string> {
  return new Set(q.toLowerCase().split(/[\s,;\/\-–]+/).filter(t => t.length > 0));
}

function patternMatches(pattern: any, query: string): boolean {
  const tokens = tokenize(query);
  const qLower = query.toLowerCase();

  if (pattern.anyOf && pattern.anyOf.length > 0) {
    const anyMatch = pattern.anyOf.some((term: string) => {
      if (term.includes(' ')) return qLower.includes(term.toLowerCase());
      return tokens.has(term.toLowerCase());
    });
    if (!anyMatch) return false;
  }

  if (pattern.noneOf && pattern.noneOf.length > 0) {
    const noneMatch = pattern.noneOf.some((term: string) => {
      if (term.includes(' ')) return qLower.includes(term.toLowerCase());
      return tokens.has(term.toLowerCase());
    });
    if (noneMatch) return false;
  }

  return true;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });

  try {
    const svc = app.get(IntentRuleService, { strict: false });
    const allRules = await svc.getAllRules();

    for (const { q, expectedCh, gotCh, note } of QUERIES) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`QUERY: "${q}"`);
      console.log(`Expected ch.${expectedCh}, Got ch.${gotCh}  [${note}]`);

      const tokens = tokenize(q);
      console.log(`Tokens: [${[...tokens].join(', ')}]`);

      const firing: Array<{ id: string; action: string; chapters: string[] }> = [];
      const allowSet = new Set<string>();
      const denySet = new Set<string>();

      for (const rule of allRules) {
        if (!patternMatches(rule.pattern, q)) continue;
        const wl = rule.whitelist ?? {};
        if (wl.allowChapters?.length) {
          firing.push({ id: rule.id, action: 'ALLOW', chapters: wl.allowChapters });
          wl.allowChapters.forEach((c: string) => allowSet.add(c));
        }
        if (wl.denyChapters?.length) {
          firing.push({ id: rule.id, action: 'DENY', chapters: wl.denyChapters });
          wl.denyChapters.forEach((c: string) => denySet.add(c));
        }
      }

      if (firing.length === 0) {
        console.log('→ No intent rules fire — OPEN query (semantic decides)');
        console.log(`  Expected ch.${expectedCh} is OPEN, got ch.${gotCh} — pure semantic ranking issue`);
      } else {
        for (const f of firing) {
          console.log(`  ${f.action}: ${f.id} → ch.[${f.chapters.join(',')}]`);
        }
        const surviving = new Set([...allowSet].filter(c => !denySet.has(c)));
        console.log(`  allowSet: [${[...allowSet].join(',')}]`);
        console.log(`  denySet:  [${[...denySet].join(',')}]`);
        console.log(`  surviving: [${[...surviving].join(',')}]`);
        if (allowSet.size > 0 && surviving.size === 0) {
          console.log('  ⚠️  EMPTY result!');
        } else if (allowSet.size > 0 && !surviving.has(expectedCh)) {
          console.log(`  ❌ Expected ch.${expectedCh} NOT in surviving set — rule conflict!`);
          console.log(`     gotCh ${gotCh} in surviving? ${surviving.has(gotCh)}`);
        } else if (allowSet.size > 0 && surviving.has(expectedCh)) {
          console.log(`  ✅ Expected ch.${expectedCh} in surviving — pure semantic ranking issue`);
        } else if (allowSet.size === 0 && denySet.has(expectedCh)) {
          console.log(`  ❌ Expected ch.${expectedCh} is DENIED — open but blocked`);
        }
      }
    }

  } finally {
    await app.close();
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
