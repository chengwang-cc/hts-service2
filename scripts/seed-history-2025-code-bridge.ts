import { config as loadEnv } from 'dotenv';
import { Pool } from 'pg';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

type BridgeSeedRow = {
  hts8: string;
  mfn_text_rate: string | null;
};

function classifyBridgeStatus(row: BridgeSeedRow): {
  bridgeStatus: string;
  reason: string;
} {
  if (row.hts8.startsWith('99') && (!row.mfn_text_rate || row.mfn_text_rate.trim() === '')) {
    return {
      bridgeStatus: 'RETIRED_CH99_PLACEHOLDER',
      reason: 'Legacy Chapter 99 placeholder row without active 2026 equivalent',
    };
  }

  return {
    bridgeStatus: 'NO_EQUIVALENT',
    reason: 'No deterministic 2026 active HTS8 equivalent found',
  };
}

async function run(): Promise<void> {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'hts',
  });

  try {
    const result = await pool.query<BridgeSeedRow>(`
      WITH code_map AS (
        SELECT DISTINCT ON (hts8)
          hts8,
          hts_number
        FROM (
          SELECT
            LEFT(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g'), 8) AS hts8,
            hts_number,
            CASE WHEN COALESCE(NULLIF(BTRIM(rate_formula), ''), '') <> '' THEN 0 ELSE 1 END AS formula_rank,
            CASE WHEN COALESCE(NULLIF(BTRIM(general_rate), ''), '') <> '' THEN 0 ELSE 1 END AS rate_text_rank,
            CASE
              WHEN LENGTH(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g')) = 10 THEN 0
              WHEN LENGTH(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g')) = 8 THEN 1
              ELSE 2
            END AS specificity_rank,
            LENGTH(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g')) AS code_len
          FROM hts
          WHERE is_active = true
        ) ranked
        WHERE hts8 IS NOT NULL
          AND LENGTH(hts8) = 8
        ORDER BY hts8, formula_rank, rate_text_rank, specificity_rank, code_len DESC, hts_number
      )
      SELECT DISTINCT h.hts8, h.mfn_text_rate
      FROM hts_tariff_history_2025 h
      LEFT JOIN code_map m ON m.hts8 = h.hts8
      WHERE m.hts_number IS NULL
      ORDER BY h.hts8
    `);

    let upserted = 0;
    const statusCounts: Record<string, number> = {};

    for (const row of result.rows) {
      const { bridgeStatus, reason } = classifyBridgeStatus(row);
      statusCounts[bridgeStatus] = (statusCounts[bridgeStatus] || 0) + 1;

      await pool.query(
        `
        INSERT INTO hts_tariff_history_2025_code_bridge (
          source_year,
          hts8,
          bridge_status,
          mapped_2026_hts_number,
          reason,
          metadata
        )
        VALUES (
          2025,
          $1,
          $2,
          NULL,
          $3,
          $4::jsonb
        )
        ON CONFLICT (source_year, hts8) DO UPDATE
          SET bridge_status = EXCLUDED.bridge_status,
              mapped_2026_hts_number = EXCLUDED.mapped_2026_hts_number,
              reason = EXCLUDED.reason,
              metadata = EXCLUDED.metadata,
              updated_at = now()
        `,
        [
          row.hts8,
          bridgeStatus,
          reason,
          JSON.stringify({
            source: 'seed-history-2025-code-bridge',
            seededAt: new Date().toISOString(),
            mfnTextRate: row.mfn_text_rate || null,
          }),
        ],
      );
      upserted++;
    }

    console.log(
      JSON.stringify(
        {
          processed: result.rows.length,
          upserted,
          statusCounts,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

