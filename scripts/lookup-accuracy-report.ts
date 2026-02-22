#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import {
  LookupAccuracySmokeService,
  LookupSmokeEvaluationSummary,
} from '../src/modules/admin/services/lookup-accuracy-smoke.service';

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}

function toPct(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return 'n/a';
  }
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function buildSummaryLines(summary: LookupSmokeEvaluationSummary): string[] {
  const auto = summary.endpointMetrics.autocomplete;
  const search = summary.endpointMetrics.search;
  const classify = summary.classificationTop1;

  return [
    `dataset: ${summary.datasetPath}`,
    `loaded: ${summary.totalRecordsLoaded}`,
    `sampled: ${summary.sampledRecords}`,
    `autocomplete exact@10: ${toPct(auto.exactTop10, auto.evaluated)}`,
    `search exact@10: ${toPct(search.exactTop10, search.evaluated)}`,
    `classify top1 exact: ${toPct(classify.exactTop1, classify.evaluated)}`,
  ];
}

async function main(): Promise<void> {
  const datasetPath = parseArg('set');
  const sampleSize = parseArg('sample');
  const classifySample = parseArg('classify-sample');
  const resultLimit = parseArg('limit');
  const outputDir = resolve(
    process.cwd(),
    parseArg('out-dir') || 'docs/reports/lookup-eval',
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const service = app.get(LookupAccuracySmokeService, {
      strict: false,
    });
    const summary = await service.runSmokeEvaluation({
      datasetPath,
      sampleSize: sampleSize ? parseInt(sampleSize, 10) : undefined,
      classifySampleSize: classifySample
        ? parseInt(classifySample, 10)
        : undefined,
      resultLimit: resultLimit ? parseInt(resultLimit, 10) : undefined,
    });

    await mkdir(outputDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `lookup-accuracy-${stamp}`;
    const jsonPath = resolve(outputDir, `${base}.json`);
    const txtPath = resolve(outputDir, `${base}.summary.txt`);

    await writeFile(jsonPath, JSON.stringify(summary, null, 2), 'utf-8');
    await writeFile(txtPath, `${buildSummaryLines(summary).join('\n')}\n`, 'utf-8');

    console.log(`Saved: ${jsonPath}`);
    console.log(`Saved: ${txtPath}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
