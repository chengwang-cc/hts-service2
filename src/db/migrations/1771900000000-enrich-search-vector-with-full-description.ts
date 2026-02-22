import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enrich HTS search_vector with full ancestor description chain.
 *
 * Problem: child entries like 9620.00.50.00 "Of plastics" don't have the word
 * "tripod" in their search_vector — the word only lives in the parent 9620.00.
 * Searching for "tripod" returns no 8/10-digit results.
 *
 * Fix: update the trigger to concatenate full_description (ancestor chain jsonb
 * array) into the tsvector so children inherit parent context words.
 */
export class EnrichSearchVectorWithFullDescription1771900000000
  implements MigrationInterface
{
  name = 'EnrichSearchVectorWithFullDescription1771900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Update the trigger function to include full_description ancestor chain
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION hts_search_vector_trigger()
      RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        full_desc_text text;
      BEGIN
        SELECT string_agg(elem, ' ')
          INTO full_desc_text
          FROM jsonb_array_elements_text(
            COALESCE(NEW.full_description, '[]'::jsonb)
          ) AS elem;

        NEW.search_vector := to_tsvector('english',
          COALESCE(NEW.hts_number, '')      || ' ' ||
          COALESCE(NEW.description, '')     || ' ' ||
          COALESCE(full_desc_text, '')
        );
        RETURN NEW;
      END;
      $$
    `);

    // 2. Backfill all active rows with the enriched search_vector
    await queryRunner.query(`
      UPDATE hts
      SET search_vector = to_tsvector('english',
        COALESCE(hts_number, '') || ' ' ||
        COALESCE(description, '') || ' ' ||
        COALESCE((
          SELECT string_agg(elem, ' ')
          FROM jsonb_array_elements_text(
            COALESCE(full_description, '[]'::jsonb)
          ) AS elem
        ), '')
      )
      WHERE is_active = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert trigger to original (hts_number + description only)
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION hts_search_vector_trigger()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        NEW.search_vector := to_tsvector('english',
          COALESCE(NEW.hts_number, '') || ' ' ||
          COALESCE(NEW.description, '')
        );
        RETURN NEW;
      END;
      $$
    `);

    // Revert backfill
    await queryRunner.query(`
      UPDATE hts
      SET search_vector = to_tsvector('english',
        COALESCE(hts_number, '') || ' ' || COALESCE(description, '')
      )
      WHERE is_active = true
    `);
  }
}
