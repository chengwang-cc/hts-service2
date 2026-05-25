#!/usr/bin/env ts-node

import 'reflect-metadata';
import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { BrokerGoldenSetService } from '../src/modules/admin/services/broker-golden-set.service';

type CsvRow = Record<string, string>;

async function main() {
  const filePath = process.argv[2];
  const dryRun =
    process.argv.includes('--dry-run') || process.argv.includes('--dry');
  if (!filePath) {
    throw new Error(
      'Usage: npm run broker:golden-set:import -- path/to/cases.csv [--dry-run]',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const service = app.get(BrokerGoldenSetService);
    let scanned = 0;
    let imported = 0;

    for await (const row of createReadStream(filePath).pipe(
      parse({ columns: true, skip_empty_lines: true, trim: true }),
    ) as AsyncIterable<CsvRow>) {
      scanned++;
      const input = {
        brokerName: required(row, 'brokerName'),
        brokerReference: required(row, 'brokerReference'),
        htsNumber: required(row, 'htsNumber'),
        originCountry: required(row, 'originCountry'),
        destinationCountry: optional(row, 'destinationCountry') || 'US',
        entryDate: required(row, 'entryDate'),
        declaredValue: numberValue(row, 'declaredValue'),
        currency: optional(row, 'currency') || 'USD',
        inputs: jsonValue(row, 'inputsJson', {}),
        expectedTotalDuty: numberValue(row, 'expectedTotalDuty'),
        expectedComponents: jsonArray(row, 'expectedComponentsJson'),
        citations: jsonArray(row, 'citationsJson'),
        brokerConfidence: optionalNumber(row, 'brokerConfidence'),
        metadata: jsonValue(row, 'metadataJson', null),
      };

      if (!dryRun) {
        await service.upsertCase(input);
      }
      imported++;
    }

    process.stdout.write(
      `broker-golden-set import ${dryRun ? '(DRY) ' : ''}done: scanned=${scanned} imported=${imported}\n`,
    );
  } finally {
    await app.close();
  }
}

function required(row: CsvRow, key: string): string {
  const value = optional(row, key);
  if (!value) {
    throw new Error(`Missing required CSV column ${key}`);
  }
  return value;
}

function optional(row: CsvRow, key: string): string | null {
  const value = row[key];
  return value && value.trim() ? value.trim() : null;
}

function numberValue(row: CsvRow, key: string): number {
  const value = required(row, key);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number in CSV column ${key}: ${value}`);
  }
  return parsed;
}

function optionalNumber(row: CsvRow, key: string): number | null {
  const value = optional(row, key);
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jsonValue<T>(row: CsvRow, key: string, fallback: T): T {
  const value = optional(row, key);
  if (!value) {
    return fallback;
  }
  return JSON.parse(value) as T;
}

function jsonArray(row: CsvRow, key: string): Array<Record<string, unknown>> {
  const parsed = jsonValue<unknown>(row, key, []);
  if (!Array.isArray(parsed)) {
    throw new Error(`CSV column ${key} must contain a JSON array`);
  }
  return parsed.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('broker-golden-set import failed:', error?.stack || error);
  process.exit(1);
});
