#!/usr/bin/env ts-node
/**
 * Export HTS training pairs for BGE-M3 fine-tuning.
 *
 * Sources:
 *  1. lookup_conversation_feedback (chosenHts + query from conversation message)
 *  2. hts_test_cases (testName/description → htsNumber)
 *
 * Output format: JSONL with one record per line:
 *   { "query": "...", "positive": "...", "negative": "..." }
 *   (negative is optional — MultipleNegativesRankingLoss works without it)
 *
 * Usage:
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/export-training-data.ts \
 *     --output=/tmp/hts-training-pairs.jsonl [--min-feedback=2]
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import { AppModule } from '../src/app.module';

function parseArg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

interface TrainingPair {
  query: string;
  positive: string;
  negative?: string;
}

async function main(): Promise<void> {
  const outputPath = parseArg('output', '/tmp/hts-training-pairs.jsonl')!;
  const minFeedback = parseInt(parseArg('min-feedback', '1')!, 10);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const ds = app.get(DataSource, { strict: false });
    const pairs: TrainingPair[] = [];

    // ── Source 1: User conversation feedback ─────────────────────────────────
    // Join feedback → session → messages to reconstruct (query, chosenHts)
    const feedbackRows = await ds.query(`
      SELECT
        f.chosen_hts,
        msg.content_json->>'text' AS user_query,
        h.description,
        ARRAY_AGG(DISTINCT desc_part) FILTER (WHERE desc_part IS NOT NULL) AS full_desc
      FROM lookup_conversation_feedback f
      JOIN lookup_conversation_sessions s ON s.id = f.session_id
      JOIN lookup_conversation_messages msg
        ON msg.session_id = s.id AND msg.role = 'user'
      JOIN hts h ON h.hts_number = f.chosen_hts AND h.is_active = true
      LEFT JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(h.full_description) = 'array'
             THEN h.full_description ELSE '[]'::jsonb END
      ) AS desc_part ON true
      WHERE f.is_correct = true
        AND f.chosen_hts IS NOT NULL
        AND msg.content_json->>'text' IS NOT NULL
        AND length(msg.content_json->>'text') > 10
      GROUP BY f.chosen_hts, msg.content_json->>'text', h.description
      ORDER BY f.chosen_hts
    `);

    console.log(`Feedback rows: ${feedbackRows.length}`);

    for (const row of feedbackRows) {
      const query = (row.user_query as string).trim().slice(0, 512);
      const descParts: string[] = Array.isArray(row.full_desc)
        ? row.full_desc
        : [];
      const positive =
        descParts.length > 0
          ? descParts.join(' | ').slice(0, 512)
          : (row.description as string).trim().slice(0, 512);

      if (query && positive) {
        pairs.push({ query, positive });
      }
    }

    // ── Source 2: HTS test cases ──────────────────────────────────────────────
    const testCaseRows = await ds.query(`
      SELECT
        tc.test_name,
        tc.description AS test_desc,
        h.description AS hts_desc,
        ARRAY_AGG(DISTINCT desc_part) FILTER (WHERE desc_part IS NOT NULL) AS full_desc
      FROM hts_test_cases tc
      JOIN hts h ON h.hts_number = tc.hts_number AND h.is_active = true
      LEFT JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(h.full_description) = 'array'
             THEN h.full_description ELSE '[]'::jsonb END
      ) AS desc_part ON true
      WHERE tc.is_active = true
        AND tc.source IN ('MANUAL', 'CUSTOMER_CASE', 'USITC_EXAMPLE')
      GROUP BY tc.test_name, tc.description, h.description
    `);

    console.log(`Test case rows: ${testCaseRows.length}`);

    for (const row of testCaseRows) {
      const descParts: string[] = Array.isArray(row.full_desc)
        ? row.full_desc
        : [];
      const positive =
        descParts.length > 0
          ? descParts.join(' | ').slice(0, 512)
          : (row.hts_desc as string).trim().slice(0, 512);

      // Use test name as query
      if (row.test_name && positive) {
        pairs.push({
          query: (row.test_name as string).trim().slice(0, 512),
          positive,
        });
      }

      // Also use test description as query if different
      if (
        row.test_desc &&
        row.test_desc !== row.test_name &&
        positive
      ) {
        pairs.push({
          query: (row.test_desc as string).trim().slice(0, 512),
          positive,
        });
      }
    }

    // ── Source 3: HTS entries self-supervision (htsNumber → description) ─────
    // Use the HTS number as a query to teach the model that "8471.30" → laptop computer
    const htsRows = await ds.query(`
      SELECT hts_number, description, full_description
      FROM hts
      WHERE is_active = true
        AND embedding_model IS NOT NULL
        AND description IS NOT NULL
        AND indent >= 2
      ORDER BY hts_number
      LIMIT 5000
    `);

    console.log(`HTS self-supervision rows: ${htsRows.length}`);

    for (const row of htsRows) {
      const descParts: string[] = Array.isArray(row.full_description)
        ? row.full_description
        : [];
      const positive =
        descParts.length > 0
          ? descParts.join(' | ').slice(0, 512)
          : (row.description as string).trim().slice(0, 512);

      if (positive) {
        pairs.push({
          query: (row.hts_number as string).trim(),
          positive,
        });
      }
    }

    // ── Deduplicate and write ─────────────────────────────────────────────────
    const seen = new Set<string>();
    const deduped = pairs.filter(({ query, positive }) => {
      const key = `${query.toLowerCase()}|||${positive.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(
      `Total pairs: ${deduped.length} (from ${pairs.length} before dedup)`,
    );

    const out = fs.createWriteStream(outputPath, { encoding: 'utf8' });
    for (const pair of deduped) {
      out.write(JSON.stringify(pair) + '\n');
    }
    out.end();

    console.log(`Written to ${outputPath}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
