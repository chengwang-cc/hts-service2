# Reciprocal Tariff Design (2026)

## Goal

Split responsibilities cleanly:

- `hts.adjusted_formula` is only for **non-reciprocal chapter-99 math synthesis**.
- Reciprocal tariffs are modeled as **policy rows in `hts_extra_taxes`**.

This prevents reciprocal logic from being embedded in HTS base formula generation.

## Runtime Contract

1. `RateRetrievalService` resolves base duty formula from HTS:
   - `GENERAL`, `OTHER`, `ADJUSTED`, `OTHER_CHAPTER99`.
2. `CalculationService` adds post-base charges from `hts_extra_taxes`:
   - `ADD_ON`, `STANDALONE`, `CONDITIONAL`, `POST_CALCULATION`.
3. Reciprocal baseline/exception logic runs only in `hts_extra_taxes` evaluation.

## Reciprocal vs. Chapter-99 Synthesis

`HtsChapter99FormulaService` now treats headings matching `9903.01.xx` as reciprocal.

- Reciprocal-only links:
  - `adjustedFormula` is cleared.
  - `chapter99Synthesis.reciprocalOnly = true` is set in metadata.
  - runtime does not classify the row as `ADJUSTED`.
- No chapter-99 links:
  - stale adjusted fields are cleared to avoid drift.

## Seeded Reciprocal Data (One-Time for 2026)

New seed: `ReciprocalTariffs2026SeedService`

- Target table: `hts_extra_taxes`
- Load marker: `hts_settings.key = seed.reciprocal_tariffs_2026.v2.loaded`
- Rows seeded:
  - `RECIP_BASELINE_9903_01_25` (ADD_ON, ALL, 10%)
  - `RECIP_CA_EXCEPTION_9903_01_26` (CONDITIONAL exclusion marker)
  - `RECIP_MX_EXCEPTION_9903_01_27` (CONDITIONAL exclusion marker)
  - `RECIP_FRAMEWORK_<COUNTRY>` country-level reciprocal framework rows (40 countries)

Seed commands:

```bash
npm run db:seed -- ReciprocalTariffs2026
npm run db:seed -- All
```

## Operational Notes

- If active `RECIP_%` rows already exist, seed skips to avoid overwriting admin-refreshed policy data.
- For reciprocal calculation, client payload must include selected chapter-99 headings in `additionalInputs`.
- Reciprocal policy refresh endpoint remains available for official-source sync.
