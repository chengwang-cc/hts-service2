#!/usr/bin/env ts-node
/**
 * Debug new cross-chapter failures found 2026-03-13 session
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

const QUERIES = [
  { q: 'Yellow dent corn Other Corn maize', expectedCh: '10', gotCh: '07', note: 'grain corn vs vegetable corn' },
  { q: 'For sowing Low erucic acid rape or colza seeds Rape or colza seeds whether or not broken', expectedCh: '12', gotCh: '15', note: 'seed for sowing vs rapeseed oil' },
  { q: 'Concrete pumps Pumps for liquids whether or not fitted with a measuring device liquid elevators part thereof', expectedCh: '84', gotCh: '64', note: 'pump machinery vs shoe pumps' },
  { q: 'Seamless Of copper-zinc base alloys brass Copper tubes and pipes', expectedCh: '74', gotCh: '93', note: 'copper tubes vs ammunition' },
  { q: 'Bars and rods of copper-nickel base alloys cupro-nickel or copper-nickel-zinc base alloys nickel silver Other Copper bars rods and profiles', expectedCh: '74', gotCh: '75', note: 'copper bars vs nickel bars' },
  { q: 'Pickup cartridges', expectedCh: '85', gotCh: '93', note: 'audio cartridge vs ammunition' },
  { q: 'Of clove Other', expectedCh: '33', gotCh: '09', note: 'clove essential oil vs spice' },
  { q: 'Rivets Nails tacks staples other than those of heading 8305 screws bolts nuts screw hooks rivets cotters cotter pins washers and similar articles', expectedCh: '76', gotCh: '73', note: 'aluminum rivets vs iron' },
  { q: 'Other Tantalum and articles thereof including waste and scrap', expectedCh: '81', gotCh: '47', note: 'tantalum metal vs wood pulp' },
  { q: 'Other Of cellular rubber or plastics whether or not covered', expectedCh: '94', gotCh: '40', note: 'mattress support vs rubber article' },
  { q: 'Hand-woven with a loom width of less than 76 cm', expectedCh: '51', gotCh: '95', note: 'wool fabric vs toy' },
  { q: 'Foxes Other Other live animals', expectedCh: '01', gotCh: '03', note: 'live fox vs aquatic' },
  { q: 'Male Purebred breeding animals Live bovine animals', expectedCh: '01', gotCh: '03', note: 'live cattle vs aquatic' },
  { q: 'Fertilized fish eggs', expectedCh: '05', gotCh: '04', note: 'animal products vs dairy eggs' },
  { q: 'Button blanks of casein', expectedCh: '96', gotCh: '35', note: 'buttons vs casein protein' },
  { q: 'Based on fish or other seafood Soups and broths and preparations therefor', expectedCh: '21', gotCh: '03', note: 'soup prep vs raw fish' },
  { q: 'Other Mattocks picks hoes and rakes and parts thereof Handtools of the following kinds and base metal parts thereof spades shovels mattocks picks hoes forks and rakes axes bill hooks and similar hewing tools secateurs and pruners of any kind scythes sickles hay knives hedge shears timber wedges and other tools of a kind used in agriculture horticulture or forestry', expectedCh: '82', gotCh: '44', note: 'hand tools vs wood' },
  { q: 'Cross-country ski gloves mittens and mitts Specially designed for use in sports', expectedCh: '42', gotCh: '95', note: 'ski gloves vs sports equipment' },
  { q: 'Other Containing added flavoring or coloring matter Cane or beet sugar and chemically pure sucrose in solid form', expectedCh: '17', gotCh: '22', note: 'sugar vs beverage' },
];

function tokenize(q: string): Set<string> {
  return new Set(q.toLowerCase().split(/[\s,;\/\-–]+/).filter(t => t.length > 0));
}

function anyOfGroupsMatch(groups: string[][], tokens: Set<string>, qLower: string): boolean {
  return groups.every(group =>
    group.some(term =>
      term.includes(' ') ? qLower.includes(term.toLowerCase()) : tokens.has(term.toLowerCase())
    )
  );
}

function patternMatches(pattern: any, query: string): boolean {
  const tokens = tokenize(query);
  const qLower = query.toLowerCase();

  // anyOf check
  if (pattern.anyOf && pattern.anyOf.length > 0) {
    const anyMatch = pattern.anyOf.some((term: string) => {
      if (term.includes(' ')) return qLower.includes(term.toLowerCase());
      return tokens.has(term.toLowerCase());
    });
    if (!anyMatch) return false;
  }

  // anyOfGroups check (AND between groups)
  if (pattern.anyOfGroups && pattern.anyOfGroups.length > 0) {
    if (!anyOfGroupsMatch(pattern.anyOfGroups, tokens, qLower)) return false;
  }

  // If both anyOf and anyOfGroups are empty/absent, it matches everything
  // (UNLESS pattern has only noneOf — treat as match-all-except-noneOf)

  // noneOf check
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
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const svc = app.get(IntentRuleService, { strict: false });
    const allRules = svc.getAllRules();

    for (const { q, expectedCh, gotCh, note } of QUERIES) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`QUERY: "${q.slice(0, 80)}${q.length > 80 ? '...' : ''}"`);
      console.log(`Expected ch.${expectedCh}, Got ch.${gotCh}  [${note}]`);

      const allowSet = new Set<string>();
      const denySet = new Set<string>();
      const firingAllow: string[] = [];
      const firingDeny: string[] = [];

      for (const rule of allRules) {
        if (!patternMatches(rule.pattern, q)) continue;
        const wl = rule.whitelist ?? {};
        if (wl.allowChapters?.length) {
          firingAllow.push(`${rule.id}→[${wl.allowChapters.join(',')}]`);
          wl.allowChapters.forEach((c: string) => allowSet.add(c));
        }
        if (wl.denyChapters?.length) {
          firingDeny.push(`${rule.id}→[${wl.denyChapters.join(',')}]`);
          wl.denyChapters.forEach((c: string) => denySet.add(c));
        }
      }

      const surviving = new Set([...allowSet].filter(c => !denySet.has(c)));

      if (allowSet.size === 0 && denySet.size === 0) {
        console.log('→ No intent rules fire — OPEN query (semantic decides)');
      } else {
        if (firingAllow.length) console.log(`  ALLOW rules: ${firingAllow.join(', ')}`);
        if (firingDeny.length) console.log(`  DENY rules:  ${firingDeny.join(', ')}`);
        console.log(`  allowSet: [${[...allowSet].sort().join(',')}]`);
        console.log(`  denySet:  [${[...denySet].sort().join(',')}]`);
        console.log(`  surviving: [${[...surviving].sort().join(',')}]`);
      }

      const expInSurv = allowSet.size === 0 ? '(open)' : surviving.has(expectedCh) ? '✅ IN' : '❌ NOT IN';
      const gotInSurv = allowSet.size === 0 ? '(open)' : surviving.has(gotCh) ? 'IN' : 'NOT IN';
      console.log(`  Expected ch.${expectedCh}: ${expInSurv} surviving | Got ch.${gotCh}: ${gotInSurv} surviving`);
    }
  } finally {
    await app.close();
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
