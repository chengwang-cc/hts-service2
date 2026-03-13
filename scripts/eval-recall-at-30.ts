#!/usr/bin/env ts-node
/**
 * Semantic Recall@30 Evaluator — Phase 4 baseline measurement.
 *
 * Measures whether the correct HTS entry appears in the top-30 semantic
 * (embedding-only) candidates BEFORE keyword fusion and reranking.
 * A recall@30 < 80% means BGE-M3 fine-tuning is needed to fix vocabulary
 * mismatch (consumer queries vs. HTS legal descriptions).
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/eval-recall-at-30.ts
 *   npx ts-node -r tsconfig-paths/register scripts/eval-recall-at-30.ts \
 *     --set=docs/evaluation/lookup-evaluation-consumer-v1.jsonl \
 *     --k=30
 */
import 'tsconfig-paths/register';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SearchService } from '../src/modules/lookup/services/search.service';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const v = process.argv.find((a) => a.startsWith(prefix));
  return v ? v.slice(prefix.length) : undefined;
}

function parseNumberArg(name: string, fallback: number): number {
  const raw = parseArg(name);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

interface EvalEntry {
  query: string;
  htsNumber: string;
  description?: string;
}

function loadEvalSet(filePath: string): EvalEntry[] {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Eval set not found: ${abs}`);
  }
  const lines = fs.readFileSync(abs, 'utf-8').split('\n').filter((l) => l.trim());
  return lines.map((line, i) => {
    try {
      const parsed = JSON.parse(line);
      if (!parsed.query || !parsed.htsNumber) {
        throw new Error(`Missing query or htsNumber`);
      }
      return { query: parsed.query, htsNumber: parsed.htsNumber, description: parsed.description };
    } catch (err) {
      throw new Error(`Invalid JSON on line ${i + 1}: ${(err as Error).message}`);
    }
  });
}

async function main(): Promise<void> {
  const datasetPath =
    parseArg('set') ||
    path.resolve(__dirname, '../docs/evaluation/lookup-evaluation-consumer-v1.jsonl');
  const k = parseNumberArg('k', 30);
  const sampleSize = parseNumberArg('sample', 0); // 0 = all

  console.log(`\nSemantic Recall@${k} Evaluator`);
  console.log(`dataset: ${datasetPath}`);
  console.log(`k: ${k}`);

  const entries = loadEvalSet(datasetPath);
  const population =
    sampleSize > 0 && sampleSize < entries.length ? entries.slice(0, sampleSize) : entries;
  console.log(`loaded: ${entries.length} entries, evaluating: ${population.length}`);

  // Bootstrap NestJS to get the SearchService with embeddings
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const searchService = app.get(SearchService);

  let hit = 0;
  let miss = 0;
  const misses: Array<{ query: string; expected: string }> = [];

  const start = Date.now();
  for (let i = 0; i < population.length; i++) {
    const { query, htsNumber } = population[i];
    try {
      const candidates = await searchService.getSemanticCandidates(query, k);
      // Match by exact code or by prefix (to handle parent vs leaf variants)
      const found =
        candidates.some((c) => c === htsNumber) ||
        candidates.some((c) => c.startsWith(htsNumber.slice(0, 6)));
      if (found) {
        hit++;
      } else {
        miss++;
        misses.push({ query, expected: htsNumber });
      }
    } catch (err) {
      console.error(`  ERROR q="${query}": ${(err as Error).message}`);
      miss++;
      misses.push({ query, expected: htsNumber });
    }

    if ((i + 1) % 20 === 0) {
      const pct = (((hit) / (i + 1)) * 100).toFixed(1);
      process.stdout.write(`  [${i + 1}/${population.length}] recall@${k}=${pct}%\r`);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const total = hit + miss;
  const recallPct = total > 0 ? ((hit / total) * 100).toFixed(2) : '0.00';

  console.log(`\n\n${'─'.repeat(60)}`);
  console.log(`Semantic Recall@${k} Results`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`dataset:   ${datasetPath}`);
  console.log(`evaluated: ${total}`);
  console.log(`hits:      ${hit}`);
  console.log(`misses:    ${miss}`);
  console.log(`recall@${k}: ${recallPct}%`);
  console.log(`runtime:   ${elapsed}s`);
  console.log(`${'─'.repeat(60)}`);

  if (misses.length > 0) {
    console.log(`\nMisses (embedding did not retrieve correct entry in top-${k}):`);
    const showMisses = misses.slice(0, 20);
    for (const m of showMisses) {
      console.log(`  q="${m.query}" → expected ${m.expected}`);
    }
    if (misses.length > 20) {
      console.log(`  ... and ${misses.length - 20} more`);
    }
  }

  const interpretation =
    parseFloat(recallPct) >= 80
      ? 'PASS — semantic candidate pool adequate; BGE-M3 fine-tuning optional'
      : parseFloat(recallPct) >= 60
        ? 'MARGINAL — BGE-M3 fine-tuning recommended to improve consumer query recall'
        : 'FAIL — BGE-M3 fine-tuning required; correct entries not reaching reranker';

  console.log(`\nInterpretation: ${interpretation}`);

  await app.close();
}

main().catch((err) => {
  console.error('\nFatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
