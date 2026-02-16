import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomNamingStrategy, CoreModule } from '@hts/core';
import {
  DocumentService,
  HtsNoteEntity,
  NoteResolutionService,
} from '@hts/knowledgebase';
import { KnowledgebaseModule } from '../src/modules/knowledgebase/knowledgebase.module';

interface CliOptions {
  dryRun: boolean;
  force: boolean;
  dedupe: boolean;
  year?: number;
  chapters?: string[];
}

interface BackfillTarget {
  year: number;
  chapter: string;
  unresolvedReferences: number;
}

interface HtsNoteCandidate {
  hts_number: string;
  version: string | null;
  general: string | null;
  other: string | null;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TypeOrmModule.forRoot({
      type: (process.env.DB_PROVIDER as 'postgres') || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_DATABASE || 'hts',
      namingStrategy: new CustomNamingStrategy(),
      autoLoadEntities: true,
      synchronize: (process.env.DB_SYNCHRONIZE || 'false') === 'true',
      ssl:
        process.env.NODE_ENV === 'development'
          ? false
          : { rejectUnauthorized: false },
      logging: false,
    }),
    CoreModule.forRoot({
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
      },
    }),
    KnowledgebaseModule,
  ],
})
class KnowledgeNoteBackfillModule {}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
    dedupe: !argv.includes('--no-dedupe'),
  };

  for (const arg of argv) {
    if (arg.startsWith('--year=')) {
      options.year = parseInt(arg.split('=')[1], 10);
    }

    if (arg.startsWith('--chapters=')) {
      const value = arg.split('=')[1] || '';
      options.chapters = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.padStart(2, '0'));
    }
  }

  return options;
}

function parseYearFromVersion(version: string | null | undefined): number | undefined {
  if (!version) {
    return undefined;
  }

  const match = version.match(/(19|20)\d{2}/);
  if (!match) {
    return undefined;
  }

  return parseInt(match[0], 10);
}

async function resolveDefaultYear(dataSource: DataSource): Promise<number> {
  const rows = await dataSource.query(`
    SELECT MAX((regexp_match(version, '(?:19|20)\\d{2}'))[1]::int) AS latest_year
    FROM hts
    WHERE is_active = true;
  `);

  return rows[0]?.latest_year || new Date().getFullYear();
}

async function loadTargets(dataSource: DataSource, options: CliOptions): Promise<BackfillTarget[]> {
  const defaultYear = options.year ?? (await resolveDefaultYear(dataSource));

  if (options.chapters && options.chapters.length > 0) {
    return options.chapters.map((chapter) => ({
      year: defaultYear,
      chapter,
      unresolvedReferences: 0,
    }));
  }

  const rows = await dataSource.query(
    `
      WITH active_rates AS (
        SELECT hts_number, chapter, version, 'general'::text AS source_column, general AS reference_text
        FROM hts
        WHERE is_active = true
          AND general ~* 'note\\s+[0-9]'
        UNION ALL
        SELECT hts_number, chapter, version, 'other'::text AS source_column, other AS reference_text
        FROM hts
        WHERE is_active = true
          AND other ~* 'note\\s+[0-9]'
      ),
      refs AS (
        SELECT
          hts_number,
          source_column,
          reference_text,
          COALESCE((regexp_match(version, '(?:19|20)\\d{2}'))[1]::int, $1::int) AS inferred_year,
          (regexp_match(reference_text, '(?:u\\.?\\s*s\\.?\\s*)?note[s]?\\s*(?:no\\.?|number)?\\s*([0-9]+[a-z]?(?:\\([a-z0-9ivx]+\\))*)', 'i'))[1] AS note_number,
          COALESCE(
            lpad((regexp_match(reference_text, '\\bchapter\\s+(\\d{1,2})\\b', 'i'))[1], 2, '0'),
            chapter
          ) AS target_chapter
        FROM active_rates
      ),
      unresolved AS (
        SELECT
          r.inferred_year AS year,
          r.target_chapter AS chapter,
          r.note_number
        FROM refs r
        LEFT JOIN LATERAL (
          SELECT n.id
          FROM hts_notes n
          WHERE n.note_number = r.note_number
            AND n.chapter = r.target_chapter
          ORDER BY n.year DESC, n.updated_at DESC
          LIMIT 1
        ) n ON true
        WHERE r.note_number IS NOT NULL
          AND n.id IS NULL
      )
      SELECT
        year,
        chapter,
        COUNT(*)::int AS unresolved_references
      FROM unresolved
      GROUP BY year, chapter
      ORDER BY unresolved_references DESC, chapter ASC;
    `,
    [defaultYear],
  );

  return (rows as Array<{ year: number; chapter: string; unresolved_references: number }>).map((row) => ({
    year: row.year,
    chapter: row.chapter,
    unresolvedReferences: row.unresolved_references,
  }));
}

async function dedupeNotes(dataSource: DataSource): Promise<number> {
  const rows = await dataSource.query(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY year, chapter, type, note_number
          ORDER BY updated_at DESC, created_at DESC, id DESC
        ) AS rank_no
      FROM hts_notes
    ),
    deleted AS (
      DELETE FROM hts_notes n
      USING ranked r
      WHERE n.id = r.id
        AND r.rank_no > 1
      RETURNING n.id
    )
    SELECT COUNT(*)::int AS deleted_count FROM deleted;
  `);

  return rows[0]?.deleted_count ?? 0;
}

async function populateReferenceAudit(
  dataSource: DataSource,
  noteResolutionService: NoteResolutionService,
): Promise<{ total: number; resolved: number; unresolved: number }> {
  const rows = (await dataSource.query(`
    SELECT hts_number, version, general, other
    FROM hts
    WHERE is_active = true
      AND (
        general ~* 'note\\s+[0-9]'
        OR other ~* 'note\\s+[0-9]'
      )
    ORDER BY hts_number ASC;
  `)) as HtsNoteCandidate[];

  let total = 0;
  let resolved = 0;
  let unresolved = 0;

  for (const row of rows) {
    const year = parseYearFromVersion(row.version);

    if (row.general && /note\s+[0-9]/i.test(row.general)) {
      total += 1;
      const result = await noteResolutionService.resolveNoteReference(
        row.hts_number,
        row.general,
        'general',
        year,
        { exactOnly: true },
      );
      if (result?.metadata?.noteId) {
        resolved += 1;
      } else {
        unresolved += 1;
      }
    }

    if (row.other && /note\s+[0-9]/i.test(row.other)) {
      total += 1;
      const result = await noteResolutionService.resolveNoteReference(
        row.hts_number,
        row.other,
        'other',
        year,
        { exactOnly: true },
      );
      if (result?.metadata?.noteId) {
        resolved += 1;
      } else {
        unresolved += 1;
      }
    }
  }

  return { total, resolved, unresolved };
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(KnowledgeNoteBackfillModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const dataSource = app.get(DataSource);
    const documentService = app.get(DocumentService);
    const noteResolutionService = app.get(NoteResolutionService);

    const noteRepo = app.get<import('typeorm').Repository<HtsNoteEntity>>(
      getRepositoryToken(HtsNoteEntity),
    );

    const targets = await loadTargets(dataSource, options);

    if (targets.length === 0) {
      console.log('No unresolved note-reference chapter targets found.');
      return;
    }

    console.log('Backfill targets:');
    for (const target of targets) {
      console.log(
        `- year=${target.year} chapter=${target.chapter} unresolved_refs=${target.unresolvedReferences}`,
      );
    }

    for (const target of targets) {
      const beforeCount = await noteRepo.count({
        where: { year: target.year, chapter: target.chapter },
      });

      if (!options.force && beforeCount > 0) {
        console.log(
          `[skip] year=${target.year} chapter=${target.chapter} already has ${beforeCount} notes (use --force to reimport)`,
        );
        continue;
      }

      if (options.dryRun) {
        console.log(
          `[dry-run] would import and parse chapter ${target.chapter} for ${target.year}`,
        );
        continue;
      }

      console.log(
        `[import] downloading chapter ${target.chapter} for year ${target.year} from USITC...`,
      );
      const document = await documentService.downloadDocument(target.year, target.chapter);

      console.log(`[import] parsing and extracting notes from document ${document.id}...`);
      const result = await documentService.parseAndExtractNotes(document.id);

      const afterCount = await noteRepo.count({
        where: { year: target.year, chapter: target.chapter },
      });

      console.log(
        `[done] chapter ${target.chapter}/${target.year}: notesExtracted=${result.notesExtracted}, notesInDb=${afterCount}`,
      );
    }

    if (!options.dryRun && options.dedupe) {
      const deleted = await dedupeNotes(dataSource);
      console.log(`[dedupe] removed duplicate note rows: ${deleted}`);
    }

    if (!options.dryRun) {
      const resolutionSummary = await populateReferenceAudit(dataSource, noteResolutionService);
      console.log('Reference resolution summary:');
      console.log(`- total references checked: ${resolutionSummary.total}`);
      console.log(`- resolved references: ${resolutionSummary.resolved}`);
      console.log(`- unresolved references: ${resolutionSummary.unresolved}`);
    }
  } finally {
    await app.close();
  }

  process.exit(0);
}

run().catch((error) => {
  console.error('knowledge-note-backfill failed:', error);
  process.exit(1);
});
