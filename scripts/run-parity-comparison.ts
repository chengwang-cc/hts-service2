#!/usr/bin/env ts-node
/**
 * Parity comparison CLI.
 *
 * Submits a `tariff-parity-comparison` job and (optionally) tails the run
 * to completion. Backed by the same admin endpoint paths
 * (POST /admin/parity/runs etc), but goes straight through Nest's
 * application context to avoid an HTTP hop in operator workflows.
 *
 * Usage:
 *   npm run parity:smoke                          # 1 chapter, 2 countries, 1 value band
 *   npm run parity:sample -- --chapters 61,62,84 --countries CN,DE,MX
 *   npm run parity:full                           # every chapter, default matrix
 *   npm run parity:smoke -- --no-wait             # submit and exit
 *
 * Env:
 *   AI_SERVICE_URL  (optional override for the upstream)
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ParityAdminService } from '../src/modules/admin/services/parity.admin.service';
import { ParityComparisonRunEntity } from '../src/modules/admin/entities/parity-comparison-run.entity';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

interface CliArgs {
  scope: 'smoke' | 'sample' | 'full' | 'custom';
  chapters?: string[];
  countries?: string[];
  valueBands?: number[];
  perHeading?: number;
  aiUrl?: string;
  wait: boolean;
  pollIntervalMs: number;
  timeoutMs: number;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    scope: 'smoke',
    wait: true,
    pollIntervalMs: 5000,
    timeoutMs: 60 * 60 * 1000, // 1h
  };
  // npm script sets the scope via the script name; first non-flag arg.
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') && !out.scope) {
      out.scope = a as CliArgs['scope'];
      continue;
    }
    if (a === '--scope' && argv[i + 1]) {
      out.scope = argv[++i] as CliArgs['scope'];
    } else if (a === '--chapters' && argv[i + 1]) {
      out.chapters = argv[++i].split(',').map((s) => s.trim());
    } else if (a === '--countries' && argv[i + 1]) {
      out.countries = argv[++i].split(',').map((s) => s.trim().toUpperCase());
    } else if (a === '--values' && argv[i + 1]) {
      out.valueBands = argv[++i].split(',').map((s) => Number(s.trim()));
    } else if (a === '--per-heading' && argv[i + 1]) {
      out.perHeading = Number(argv[++i]);
    } else if (a === '--ai-url' && argv[i + 1]) {
      out.aiUrl = argv[++i];
    } else if (a === '--no-wait') {
      out.wait = false;
    } else if (a === '--poll-ms' && argv[i + 1]) {
      out.pollIntervalMs = Number(argv[++i]);
    } else if (a === '--timeout-ms' && argv[i + 1]) {
      out.timeoutMs = Number(argv[++i]);
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        `Usage: parity-comparison [--scope smoke|sample|full|custom] [--chapters a,b,c]\n` +
          `                        [--countries CN,DE,MX] [--values 50,1000,50000]\n` +
          `                        [--per-heading N] [--ai-url URL] [--no-wait]\n`,
      );
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(ParityAdminService);
    const runRepo = app.get<Repository<ParityComparisonRunEntity>>(
      getRepositoryToken(ParityComparisonRunEntity),
    );

    const run = await svc.startRun({
      dto: {
        scope: args.scope,
        chapters: args.chapters,
        countries: args.countries,
        valueBands: args.valueBands,
        perHeading: args.perHeading,
        aiServiceUrl: args.aiUrl,
      },
      initiatedBy: process.env.USER || 'cli',
    });

    process.stdout.write(
      `\nQueued parity run: id=${run.id} scope=${run.scope}\n`,
    );

    if (!args.wait) {
      process.stdout.write(`(--no-wait) returning early. Track via GET /admin/parity/runs/${run.id}\n`);
      return;
    }

    // Tail until completed / cancelled / failed.
    const start = Date.now();
    while (Date.now() - start < args.timeoutMs) {
      await sleep(args.pollIntervalMs);
      const fresh = await runRepo.findOne({ where: { id: run.id } });
      if (!fresh) {
        process.stdout.write(`Run ${run.id} disappeared. Aborting.\n`);
        process.exit(1);
      }
      process.stdout.write(
        `[${fresh.status}] processed=${fresh.rowsProcessed}/${fresh.corpusSize} ` +
          `matched=${fresh.rowsMatched} mismatched=${fresh.rowsMismatched} ` +
          `unavailable=${fresh.rowsAiServiceUnavailable}\n`,
      );
      if (
        fresh.status === 'completed' ||
        fresh.status === 'cancelled' ||
        fresh.status === 'failed'
      ) {
        process.stdout.write(
          `\nFinal: ${fresh.status}. ` +
            `match%=${(((fresh.rowsMatched || 0) / Math.max(1, fresh.corpusSize)) * 100).toFixed(2)}\n` +
            `Summary: ${JSON.stringify(fresh.summary, null, 2)}\n`,
        );
        return;
      }
    }

    process.stdout.write(
      `\nTimed out after ${args.timeoutMs}ms. Run still in flight: ${run.id}\n`,
    );
  } finally {
    await app.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('parity-comparison CLI failed:', err?.stack || err);
  process.exit(1);
});
