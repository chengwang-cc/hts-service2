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
  const sampleSize = parseArg('sample');
  const classifySample = parseArg('classify-sample');
  const resultLimit = parseArg('limit');
  const json = parseArg('json') === 'true';
  const sourceVersion = parseArg('source-version');

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
