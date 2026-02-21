import * as fs from 'node:fs';
import * as path from 'node:path';

type TariffRow = {
  hts8: string;
  chapter: string;
  briefDescription: string;
};

type ChapterSummary = {
  chapter: string;
  totalAvailable: number;
  selectedCount: number;
};

const INPUT_FILE = path.resolve('.tmp/usitc/tariff_database_2025.txt');
const OUTPUT_DIR = path.resolve('docs/reports/formula-input-matrix-20260218');
const SAMPLE_OUTPUT = path.join(OUTPUT_DIR, 'hts-chapter-samples-20-per-chapter.csv');
const MATRIX_OUTPUT = path.join(OUTPUT_DIR, 'hts-major-country-input-matrix.csv');
const SUMMARY_OUTPUT = path.join(OUTPUT_DIR, 'summary.json');

const TARGET_PER_CHAPTER = 20;
const MAJOR_COUNTRIES = ['CN', 'CA', 'EU', 'JP', 'RU'];

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = i + 1 < line.length ? line[i + 1] : '';

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function normalizeHts8(value: string): string | null {
  const digits = (value || '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(digits)) {
    return null;
  }
  return digits;
}

function chapterFromHts8(hts8: string): string {
  return hts8.slice(0, 2);
}

function formatHtsForApi(hts8: string): string {
  return `${hts8.slice(0, 4)}.${hts8.slice(4, 6)}.${hts8.slice(6, 8)}`;
}

function csvEscape(value: string | number): string {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function main(): void {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Input file not found: ${INPUT_FILE}`);
  }

  const content = fs.readFileSync(INPUT_FILE, 'utf8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) {
    throw new Error(`Input file has no data rows: ${INPUT_FILE}`);
  }

  const rowsByHts8 = new Map<string, TariffRow>();

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const hts8 = normalizeHts8(fields[0] || '');
    if (!hts8) {
      continue;
    }
    if (rowsByHts8.has(hts8)) {
      continue;
    }
    const briefDescription = (fields[1] || '').trim();
    rowsByHts8.set(hts8, {
      hts8,
      chapter: chapterFromHts8(hts8),
      briefDescription,
    });
  }

  const byChapter = new Map<string, TariffRow[]>();
  for (const row of rowsByHts8.values()) {
    if (!byChapter.has(row.chapter)) {
      byChapter.set(row.chapter, []);
    }
    byChapter.get(row.chapter)!.push(row);
  }

  const chapters = Array.from(byChapter.keys()).sort((a, b) => Number(a) - Number(b));
  const selectedRows: TariffRow[] = [];
  const summary: ChapterSummary[] = [];

  for (const chapter of chapters) {
    const rows = byChapter.get(chapter)!;
    const ordered = rows.sort((a, b) => a.hts8.localeCompare(b.hts8));
    const selected = ordered.slice(0, TARGET_PER_CHAPTER);

    selectedRows.push(...selected);
    summary.push({
      chapter,
      totalAvailable: ordered.length,
      selectedCount: selected.length,
    });
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const sampleHeader = [
    'chapter',
    'rank_in_chapter',
    'hts8',
    'api_hts_number',
    'brief_description',
  ];
  const sampleRows = [sampleHeader.join(',')];
  for (const chapter of chapters) {
    const selected = selectedRows
      .filter((row) => row.chapter === chapter)
      .sort((a, b) => a.hts8.localeCompare(b.hts8));
    selected.forEach((row, index) => {
      sampleRows.push(
        [
          csvEscape(chapter),
          csvEscape(index + 1),
          csvEscape(row.hts8),
          csvEscape(formatHtsForApi(row.hts8)),
          csvEscape(row.briefDescription),
        ].join(','),
      );
    });
  }
  fs.writeFileSync(SAMPLE_OUTPUT, `${sampleRows.join('\n')}\n`, 'utf8');

  const matrixHeader = [
    'chapter',
    'rank_in_chapter',
    'hts8',
    'api_hts_number',
    'country_code',
    'entry_date',
    'example_payload',
  ];
  const matrixRows = [matrixHeader.join(',')];
  for (const chapter of chapters) {
    const selected = selectedRows
      .filter((row) => row.chapter === chapter)
      .sort((a, b) => a.hts8.localeCompare(b.hts8));
    selected.forEach((row, index) => {
      const apiHts = formatHtsForApi(row.hts8);
      for (const country of MAJOR_COUNTRIES) {
        const payload = JSON.stringify({
          htsNumber: apiHts,
          countryOfOrigin: country,
          entryDate: '2026-01-15',
          declaredValue: 1000,
        });
        matrixRows.push(
          [
            csvEscape(chapter),
            csvEscape(index + 1),
            csvEscape(row.hts8),
            csvEscape(apiHts),
            csvEscape(country),
            csvEscape('2026-01-15'),
            csvEscape(payload),
          ].join(','),
        );
      }
    });
  }
  fs.writeFileSync(MATRIX_OUTPUT, `${matrixRows.join('\n')}\n`, 'utf8');

  const summaryPayload = {
    generatedAt: new Date().toISOString(),
    inputFile: path.relative(process.cwd(), INPUT_FILE),
    targetPerChapter: TARGET_PER_CHAPTER,
    majorCountries: MAJOR_COUNTRIES,
    chaptersCovered: chapters.length,
    rowsSelected: selectedRows.length,
    matrixRows: matrixRows.length - 1,
    chapterBreakdown: summary,
  };
  fs.writeFileSync(SUMMARY_OUTPUT, `${JSON.stringify(summaryPayload, null, 2)}\n`, 'utf8');

  // eslint-disable-next-line no-console
  console.log(
    `Generated ${selectedRows.length} chapter samples and ${matrixRows.length - 1} matrix rows in ${path.relative(process.cwd(), OUTPUT_DIR)}`,
  );
}

main();
