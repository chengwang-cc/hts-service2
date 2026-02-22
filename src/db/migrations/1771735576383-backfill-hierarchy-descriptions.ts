import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill hierarchy fields for all HTS entries.
 *
 * Problem: The staging import pipeline (mapStageToEntity) does not build
 * parentHtses, parentHtsNumber, or fullDescription — so all entries imported
 * via the admin import job have NULL for these fields.
 *
 * HTS code lengths are always exactly 4, 7, 10, or 13 characters:
 *   4  → heading    (e.g. "9620")
 *   7  → subheading (e.g. "9620.00")
 *   10 → 8-digit    (e.g. "9620.00.50")
 *   13 → 10-digit   (e.g. "9620.00.50.00")
 *
 * Fix: Use exact substring lookups on the indexed hts_number column to find
 * ancestors at positions 1-4, 1-7, and 1-10.  This is O(n log n) — much
 * faster than LIKE-based self-joins.
 *
 * After populating fullDescription, re-run the search_vector backfill so
 * child entries inherit parent context words (e.g. "tripod" in 9620.00.50.00).
 */
export class BackfillHierarchyDescriptions1771735576383
  implements MigrationInterface
{
  name = 'BackfillHierarchyDescriptions1771735576383';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Backfill parent_hts_number (closest ancestor: 10→7→4 fallback)
    await queryRunner.query(`
      UPDATE hts child
      SET parent_hts_number = COALESCE(
        -- 10-char parent (for 13-char codes)
        CASE WHEN length(child.hts_number) = 13 THEN (
          SELECT p.hts_number FROM hts p
          WHERE p.hts_number = substring(child.hts_number, 1, 10) AND p.is_active = true
          LIMIT 1
        ) END,
        -- 7-char parent (for 10-char codes)
        CASE WHEN length(child.hts_number) >= 10 THEN (
          SELECT p.hts_number FROM hts p
          WHERE p.hts_number = substring(child.hts_number, 1, 7) AND p.is_active = true
          LIMIT 1
        ) END,
        -- 4-char parent (for 7-char codes)
        CASE WHEN length(child.hts_number) >= 7 THEN (
          SELECT p.hts_number FROM hts p
          WHERE p.hts_number = substring(child.hts_number, 1, 4) AND p.is_active = true
          LIMIT 1
        ) END
      )
      WHERE child.is_active = true
        AND child.parent_hts_number IS NULL
        AND length(child.hts_number) > 4
    `);

    // 2. Backfill parent_htses (all ancestors ordered root → direct parent)
    await queryRunner.query(`
      UPDATE hts child
      SET parent_htses = (
        SELECT jsonb_agg(anc ORDER BY ord)
        FROM (
          -- 4-char ancestor (exists for all codes > 4 chars)
          SELECT 1 AS ord, p1.hts_number AS anc
          FROM hts p1
          WHERE p1.hts_number = substring(child.hts_number, 1, 4)
            AND p1.is_active = true
            AND length(child.hts_number) > 4
          UNION ALL
          -- 7-char ancestor (exists for 10-char and 13-char codes)
          SELECT 2, p2.hts_number
          FROM hts p2
          WHERE p2.hts_number = substring(child.hts_number, 1, 7)
            AND p2.is_active = true
            AND length(child.hts_number) > 7
          UNION ALL
          -- 10-char ancestor (exists for 13-char codes)
          SELECT 3, p3.hts_number
          FROM hts p3
          WHERE p3.hts_number = substring(child.hts_number, 1, 10)
            AND p3.is_active = true
            AND length(child.hts_number) > 10
        ) ancestors
      )
      WHERE child.is_active = true
        AND (child.parent_htses IS NULL OR jsonb_array_length(COALESCE(child.parent_htses, '[]'::jsonb)) = 0)
        AND length(child.hts_number) > 4
    `);

    // 3. Backfill full_description:
    //    [ancestor_desc_0, ancestor_desc_1, ..., current_desc]
    await queryRunner.query(`
      UPDATE hts child
      SET full_description = (
        SELECT jsonb_agg(d ORDER BY ord)
        FROM (
          -- 4-char ancestor description
          SELECT 1 AS ord, p1.description AS d
          FROM hts p1
          WHERE p1.hts_number = substring(child.hts_number, 1, 4)
            AND p1.is_active = true
            AND length(child.hts_number) > 4
          UNION ALL
          -- 7-char ancestor description
          SELECT 2, p2.description
          FROM hts p2
          WHERE p2.hts_number = substring(child.hts_number, 1, 7)
            AND p2.is_active = true
            AND length(child.hts_number) > 7
          UNION ALL
          -- 10-char ancestor description
          SELECT 3, p3.description
          FROM hts p3
          WHERE p3.hts_number = substring(child.hts_number, 1, 10)
            AND p3.is_active = true
            AND length(child.hts_number) > 10
          UNION ALL
          -- Current entry's own description
          SELECT 4, child.description
        ) desc_chain
      )
      WHERE child.is_active = true
    `);

    // 4. For top-level 4-char codes (headings), set full_description to just their own description
    await queryRunner.query(`
      UPDATE hts
      SET full_description = jsonb_build_array(description)
      WHERE is_active = true
        AND length(hts_number) = 4
        AND (full_description IS NULL OR jsonb_array_length(COALESCE(full_description, '[]'::jsonb)) = 0)
    `);

    // 5. Re-run search_vector backfill so child entries inherit parent context words
    await queryRunner.query(`
      UPDATE hts
      SET search_vector = to_tsvector('english',
        COALESCE(hts_number, '') || ' ' ||
        COALESCE(description, '') || ' ' ||
        COALESCE((
          SELECT string_agg(elem, ' ')
          FROM jsonb_array_elements_text(COALESCE(full_description, '[]'::jsonb)) AS elem
        ), '')
      )
      WHERE is_active = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert: clear the backfilled hierarchy fields
    await queryRunner.query(`
      UPDATE hts
      SET
        parent_hts_number = NULL,
        parent_htses = NULL,
        full_description = NULL
      WHERE is_active = true
    `);

    // Revert search_vector to hts_number + description only
    await queryRunner.query(`
      UPDATE hts
      SET search_vector = to_tsvector('english',
        COALESCE(hts_number, '') || ' ' || COALESCE(description, '')
      )
      WHERE is_active = true
    `);
  }
}
