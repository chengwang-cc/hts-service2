#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

async function fix() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });

    // New rule: automotive ignition electrical components → ch.85 (8511)
    // "Automotive Ignition Switch" → EMPTY because semantic search doesn't match
    // 8511 (ignition magnetos) well when "switch" is present. Need positive rule.
    const ignitionRule: IntentRule = {
      id: 'AUTOMOTIVE_IGNITION_ELECTRICAL_INTENT',
      description: 'Automotive ignition switches, coils, modules → 8511 (ch.85). ' +
        'Previously "ignition switch" → EMPTY (removed from ch.91 time-switch rule, ' +
        'but no positive rule existed for ch.85 ignition electrical components).',
      pattern: {
        anyOf: [
          'ignition switch', 'ignition cylinder', 'ignition lock cylinder',
          'ignition coil', 'ignition coils', 'ignition module', 'ignition control module',
          'ignition magneto', 'ignition system', 'ignition wire', 'ignition wires',
          'ignition cable', 'spark plug wire', 'plug wire set',
          'starter motor', 'starter solenoid', 'starter relay',
          'distributor cap', 'rotor cap', 'ignition rotor',
          'car ignition', 'auto ignition', 'vehicle ignition',
        ],
        noneOf: [
          'key fob', 'transponder key', 'locksmith', 'lockpick',
        ],
      },
      whitelist: { allowChapters: ['85'] },
      inject: [
        { prefix: '8511.40.00', syntheticRank: 9 }, // Ignition magnetos, distributors
        { prefix: '8511.80.00', syntheticRank: 8 }, // Other ignition equipment
        { prefix: '8511.10.00', syntheticRank: 7 }, // Spark plugs
        { prefix: '8511.20.00', syntheticRank: 6 }, // Ignition magnetos/generators
      ],
      boosts: [
        { delta: 0.4, prefixMatch: '8511' },
      ],
    } as IntentRule;

    await (svc as any).upsertRule(ignitionRule, 590, true);
    console.log('Created AUTOMOTIVE_IGNITION_ELECTRICAL_INTENT');
    await svc.reload();
    console.log('Done. Rules in cache:', svc.ruleCount);
  } finally {
    await app.close();
  }
}
fix().catch(e => { console.error('Fatal:', e); process.exit(1); });
