#!/usr/bin/env ts-node
/**
 * Shadow comparator CLI.
 *
 * Reads a corpus JSON file (array of rows with htsCode/country/inputs),
 * runs each row through the local hts-service TariffRateBatchService and
 * the legacy ai-service /v2/tariff/rates endpoint, and writes a diff
 * report alongside.
 *
 * Usage:
 *   npm run cli:shadow-compare -- --corpus ./fixtures/shadow-corpus.json \
 *                                  --out ./tmp/shadow-report.json
 *
 * Env required:
 *   AI_SERVICE_URL       e.g. http://localhost:3001/v2/tariff
 *   AI_SERVICE_API_KEY   optional, attached as X-API-Key
 */

import 'reflect-metadata';
import { promises as fs } from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ShadowComparatorService } from '../src/modules/calculator/services/shadow-comparator.service';

interface CliArgs {
  corpus: string;
  out?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: Partial<CliArgs> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--corpus' && argv[i + 1]) {
      out.corpus = argv[++i];
    } else if (a === '--out' && argv[i + 1]) {
      out.out = argv[++i];
    }
  }
  if (!out.corpus) {
    throw new Error('--corpus <path> is required');
  }
  return out as CliArgs;
}

async function main() {
  const args = parseArgs(process.argv);

  const corpusPath = path.resolve(args.corpus);
  const raw = await fs.readFile(corpusPath, 'utf-8');
  const corpus = JSON.parse(raw);
  if (!Array.isArray(corpus)) {
    throw new Error(`Corpus file must be a JSON array (got ${typeof corpus})`);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(ShadowComparatorService);
    const aiServiceUrl =
      process.env.AI_SERVICE_URL || 'http://localhost:3001/v2/tariff';
    const aiServiceApiKey = process.env.AI_SERVICE_API_KEY || undefined;

    const report = await svc.compareCorpus(corpus, {
      aiServiceUrl,
      aiServiceApiKey,
    });

    const outPath = args.out
      ? path.resolve(args.out)
      : path.resolve(`./shadow-report-${Date.now()}.json`);

    await fs.writeFile(outPath, JSON.stringify(report, null, 2));

    process.stdout.write(
      `\nShadow compare: ${report.matched}/${report.rows} matched ` +
        `(${(report.matchRate * 100).toFixed(2)}%)\n` +
        `Mismatch by reason: ${JSON.stringify(report.mismatchByReason)}\n` +
        `Report written to ${outPath}\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('shadow-compare failed:', err?.stack || err);
  process.exit(1);
});
