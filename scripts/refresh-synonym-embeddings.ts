#!/usr/bin/env ts-node
/**
 * Re-embeds HTS codes that have product_synonyms populated.
 * Queries hts WHERE product_synonyms IS NOT NULL AND is_active=true,
 * rebuilds the embedding search text (now including synonyms), and updates
 * embeddingOpenai + embeddingSearchText.
 *
 * Usage:
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/refresh-synonym-embeddings.ts
 *   npx ts-node ... --batch=100  # batch size (default 50)
 */
import 'tsconfig-paths/register';
import * as dotenv from 'dotenv';
import * as path from 'path';
import OpenAI from 'openai';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function getArg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const m = process.argv.find((a) => a.startsWith(prefix));
  return m ? m.slice(prefix.length) : fallback;
}

const BATCH_SIZE = parseInt(getArg('batch', '50')!, 10);
const DRY_RUN = process.argv.includes('--dry-run');

// Mirror of HtsEmbeddingGenerationService.buildSearchText() with productSynonyms
function buildSearchText(row: {
  hts_number: string;
  description: string | null;
  full_description: string[] | null;
  heading: string | null;
  chapter: string | null;
  unit_of_quantity: string | null;
  product_synonyms: string | null;
}): string {
  const parts: string[] = [];

  if (row.hts_number) parts.push(row.hts_number.replace(/[^0-9.]/g, '').trim());

  // Chapter + heading context
  if (row.chapter) parts.push(`Chapter ${row.chapter}`);
  if (row.heading) parts.push(`Heading ${row.heading}`);

  // Full description chain
  const fullDesc = row.full_description || [];
  for (const d of fullDesc) {
    const n = d.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (n && !parts.map(p => p.toLowerCase()).includes(n)) parts.push(n);
  }

  // Leaf description (if not already in fullDesc)
  if (row.description) {
    const n = row.description.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (n && !parts.map(p => p.toLowerCase()).includes(n)) parts.push(n);
  }

  // Unit of quantity
  if (row.unit_of_quantity) {
    const n = row.unit_of_quantity.trim();
    if (n) parts.push(n);
  }

  // Product synonyms
  if (row.product_synonyms) {
    const n = row.product_synonyms.trim();
    if (n) parts.push(n);
  }

  return parts.join(' ');
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const openai = new OpenAI({ apiKey });

  const db = new Client({
    host: process.env.DB_HOST || '192.168.1.209',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'wbroot0216',
    database: process.env.DB_DATABASE || 'hts',
  });
  await db.connect();
  console.log('Connected to DB');

  const result = await db.query(`
    SELECT id, hts_number, description, chapter, heading,
           COALESCE(full_description::text, '[]') AS full_description,
           unit_of_quantity, product_synonyms
    FROM hts
    WHERE is_active = true
      AND product_synonyms IS NOT NULL
    ORDER BY chapter, hts_number
  `);

  const rows = result.rows.map((r) => ({
    ...r,
    full_description: (() => {
      try { return JSON.parse(r.full_description); } catch { return []; }
    })(),
  }));

  console.log(`Found ${rows.length} rows with product_synonyms to re-embed`);

  if (DRY_RUN) {
    const sample = rows.slice(0, 5);
    for (const r of sample) {
      const text = buildSearchText(r);
      console.log(`\n${r.hts_number}: ${text.slice(0, 150)}...`);
    }
    await db.end();
    return;
  }

  let processed = 0, failed = 0;
  const now = new Date();

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map(buildSearchText);

    try {
      const embResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts,
      });

      for (let j = 0; j < batch.length; j++) {
        const vector = embResponse.data[j].embedding;
        await db.query(
          `UPDATE hts SET embedding_openai = $1, embedding_search_text = $2, embedding_openai_generated_at = $3 WHERE id = $4`,
          [`[${vector.join(',')}]`, texts[j], now, batch[j].id],
        );
        processed++;
      }
    } catch (err) {
      console.error(`Batch ${i}-${i + BATCH_SIZE} failed:`, err instanceof Error ? err.message : String(err));
      failed += batch.length;
    }

    process.stdout.write(`\rProcessed ${processed}/${rows.length} (${failed} failed)...`);
  }

  console.log(`\nDone. ${processed} re-embedded, ${failed} failed.`);
  await db.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
