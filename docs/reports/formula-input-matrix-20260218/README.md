# HTS Formula Input Matrix (2026-02-18)

This folder contains generated input datasets for formula/rate validation using HTS code + country.

## Files

- `hts-chapter-samples-20-per-chapter.csv`
  - Up to 20 HTS8 lines per chapter (sorted ascending).
  - Columns: `chapter`, `rank_in_chapter`, `hts8`, `api_hts_number`, `brief_description`.

- `hts-major-country-input-matrix.csv`
  - Cross-product of the chapter sample list with major-country codes:
    - `CN`, `CA`, `EU`, `JP`, `RU`
  - Columns: `chapter`, `rank_in_chapter`, `hts8`, `api_hts_number`, `country_code`, `entry_date`, `example_payload`.

- `summary.json`
  - Generation metadata and per-chapter availability/selection counts.

## Source and generation

- Source file: `.tmp/usitc/tariff_database_2025.txt`
- Generator: `scripts/generate-hts-formula-input-matrix.ts`

Run:

```bash
npx ts-node -P ./tsconfig.json -r tsconfig-paths/register ./scripts/generate-hts-formula-input-matrix.ts
```

## Scope notes

- Chapter `77` has no rows in the source file and is not represented.
- Some chapters contain fewer than 20 legal lines; those chapters use all available rows.
