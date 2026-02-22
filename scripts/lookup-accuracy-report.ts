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

function parseNumberArg(name: string): number | undefined {
  const raw = parseArg(name);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  const sampleSize = parseNumberArg('sample');
  const classifySample = parseNumberArg('classify-sample');
  const resultLimit = parseNumberArg('limit');
  const outputDir = resolve(
    process.cwd(),
    parseArg('out-dir') || 'docs/reports/lookup-eval',
  );
  const prevalidate = (parseArg('prevalidate') ?? 'true') !== 'false';
  const allowLargeClassify =
    (parseArg('allow-large-classify') ?? 'false') === 'true';
  const maxClassifyWithoutConfirm = parseInt(
    process.env.HTS_LOOKUP_MAX_CLASSIFY_SAMPLE_NO_CONFIRM || '25',
    10,
  );

  if (
    Number.isFinite(classifySample) &&
    (classifySample as number) > maxClassifyWithoutConfirm &&
    !allowLargeClassify
  ) {
    throw new Error(
      `classify-sample=${classifySample} exceeds safe limit ${maxClassifyWithoutConfirm}. ` +
        `Re-run with --allow-large-classify=true after preflight validation.`,
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const service = app.get(LookupAccuracySmokeService, {
      strict: false,
    });

    if (prevalidate) {
      const preflightSample = Math.max(
        10,
        Math.min(sampleSize ?? 200, 50),
      );
      const preflight = await service.runSmokeEvaluation({
        datasetPath,
        sampleSize: preflightSample,
        classifySampleSize: 0,
        resultLimit: resultLimit ?? 10,
      });

      console.log(
        `Preflight passed: sampled=${preflight.sampledRecords}, ` +
          `autocomplete_exact@10=${toPct(preflight.endpointMetrics.autocomplete.exactTop10, preflight.endpointMetrics.autocomplete.evaluated)}, ` +
          `search_exact@10=${toPct(preflight.endpointMetrics.search.exactTop10, preflight.endpointMetrics.search.evaluated)}`,
      );
    }

    const summary = await service.runSmokeEvaluation({
      datasetPath,
      sampleSize,
      classifySampleSize: classifySample,
      resultLimit,
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
