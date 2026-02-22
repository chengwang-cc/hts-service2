#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HtsEmbeddingGenerationService } from '../src/core/services/hts-embedding-generation.service';
import { HtsEntity } from '../src/core/entities/hts.entity';

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}

async function resolveSourceVersion(
  repository: Repository<HtsEntity>,
  requested?: string,
): Promise<string> {
  if (requested) {
    return requested;
  }

  const latest = await repository.findOne({
    where: {
      isActive: true,
      sourceVersion: Not(IsNull()),
    },
    select: ['sourceVersion'],
    order: { updatedAt: 'DESC' },
  });

  if (!latest?.sourceVersion) {
    throw new Error('Could not resolve active sourceVersion from HTS table');
  }

  return latest.sourceVersion;
}

async function main(): Promise<void> {
  const sourceArg = parseArg('source');
  const batchArg = parseArg('batch');
  const modelArg = parseArg('model');

  const batchSize = batchArg ? Math.max(1, parseInt(batchArg, 10)) : 200;
  const modelVersion = modelArg || 'text-embedding-3-small';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const embedService = app.get(HtsEmbeddingGenerationService, {
      strict: false,
    });
    const dataSource = app.get(DataSource, { strict: false });
    const htsRepository = dataSource.getRepository(HtsEntity);

    const sourceVersion = await resolveSourceVersion(htsRepository, sourceArg);
    console.log(
      `Refreshing HTS embeddings for source=${sourceVersion} batch=${batchSize} model=${modelVersion}`,
    );

    const result = await embedService.generateEmbeddingsForSourceVersion(
      sourceVersion,
      batchSize,
      modelVersion,
    );

    console.log(
      `Done: total=${result.total}, generated=${result.generated}, failed=${result.failed}`,
    );
    if (result.errors.length > 0) {
      console.log(`Errors (first 10):`);
      result.errors.slice(0, 10).forEach((err) => console.log(`- ${err}`));
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
