#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
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

function printSummary(summary: LookupSmokeEvaluationSummary): void {
  const autocomplete = summary.endpointMetrics.autocomplete;
  const search = summary.endpointMetrics.search;
  const classify = summary.classificationTop1;

  console.log('Lookup Accuracy Smoke Summary');
  console.log(`dataset: ${summary.datasetPath}`);
  console.log(`loaded: ${summary.totalRecordsLoaded}`);
  console.log(`sampled: ${summary.sampledRecords}`);
  if (summary.sourceVersion) {
    console.log(`sourceVersion: ${summary.sourceVersion}`);
  }
  console.log('');
  console.log('autocomplete');
  console.log(`  evaluated: ${autocomplete.evaluated}`);
  console.log(`  exact@1: ${toPct(autocomplete.exactTop1, autocomplete.evaluated)}`);
  console.log(`  exact@3: ${toPct(autocomplete.exactTop3, autocomplete.evaluated)}`);
  console.log(`  exact@10: ${toPct(autocomplete.exactTop10, autocomplete.evaluated)}`);
  console.log(
    `  chapter@10: ${toPct(autocomplete.chapterTop10, autocomplete.evaluated)}`,
  );
  console.log(`  errors: ${autocomplete.errors}`);
  console.log('');
  console.log('search');
  console.log(`  evaluated: ${search.evaluated}`);
  console.log(`  exact@1: ${toPct(search.exactTop1, search.evaluated)}`);
  console.log(`  exact@3: ${toPct(search.exactTop3, search.evaluated)}`);
  console.log(`  exact@10: ${toPct(search.exactTop10, search.evaluated)}`);
  console.log(`  chapter@10: ${toPct(search.chapterTop10, search.evaluated)}`);
  console.log(`  errors: ${search.errors}`);
  console.log('');
  console.log('classify');
  console.log(`  evaluated: ${classify.evaluated}`);
  console.log(`  top1 exact: ${toPct(classify.exactTop1, classify.evaluated)}`);
  console.log(`  top1 chapter: ${toPct(classify.chapterTop1, classify.evaluated)}`);
  console.log(`  errors: ${classify.errors}`);
}

async function main(): Promise<void> {
  const datasetPath = parseArg('set');
  const sampleSize = parseNumberArg('sample');
  const classifySample = parseNumberArg('classify-sample');
  const resultLimit = parseNumberArg('limit');
  const json = parseArg('json') === 'true';
  const sourceVersion = parseArg('source-version');
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
        sourceVersion,
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
      sourceVersion,
    });

    if (json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printSummary(summary);
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
