# HTS Formula and Rate Construction: Deep Code Review Guideline

Date: 2026-02-18
Scope: `hts-service` formula/rate construction and runtime duty calculation path.
Method: line-by-line review of the files listed below; no inferred behavior outside code.

## 1. Files Reviewed Line-by-Line

- `hts-service/src/modules/public-api/v1/controllers/calculator-public.controller.ts`
- `hts-service/src/modules/public-api/v1/dto/calculate-public.dto.ts`
- `hts-service/packages/calculator/src/services/calculation.service.ts`
- `hts-service/packages/calculator/src/services/rate-retrieval.service.ts`
- `hts-service/packages/calculator/src/services/formula-evaluation.service.ts`
- `hts-service/packages/core/src/services/formula-generation.service.ts`
- `hts-service/packages/core/src/services/hts-formula-generation.service.ts`
- `hts-service/packages/core/src/services/hts-chapter99-formula.service.ts`
- `hts-service/packages/core/src/services/hts-formula-update.service.ts`
- `hts-service/packages/core/src/entities/hts.entity.ts`
- `hts-service/packages/core/src/entities/hts-extra-tax.entity.ts`
- `hts-service/packages/core/src/entities/hts-formula-update.entity.ts`
- `hts-service/packages/core/src/entities/hts-tariff-history-2025.entity.ts`
- `hts-service/packages/core/src/entities/calculation-history.entity.ts`
- `hts-service/packages/knowledgebase/src/services/note-resolution.service.ts`
- `hts-service/src/modules/admin/jobs/hts-import.job-handler.ts`
- `hts-service/src/seeds/tariff-history/tariff-history-2025.seed.service.ts`
- `hts-service/src/seeds/reciprocal/reciprocal-tariffs-2026.seed.ts`
- `hts-service/src/seeds/reciprocal/reciprocal-tariffs-2026.seed.service.ts`
- `hts-service/src/seeds/seed.service.ts`

## 2. Runtime Construction Path (Authoritative)

### 2.1 API entry and date normalization

1. Request enters `POST /api/v1/calculator/calculate`.
2. Entry date is resolved from:
   - `input.entryDate`, else
   - `input.additionalInputs.entryDate`, else `undefined`.
3. Controller forwards this to calculator service.

Evidence:
- `calculator-public.controller.ts:73-85`
- `calculator-public.controller.ts:88`

### 2.2 Core calculation flow

1. Input normalization:
   - `htsNumber` trim
   - `countryOfOrigin` uppercase
   - trade agreement normalization
2. Rate/formula retrieval via `RateRetrievalService.getRate(...)`.
3. Formula evaluation for base duty (or trade agreement formula override).
4. Additional tariffs from `hts_extra_taxes` (`ADD_ON`, `STANDALONE`, `CONDITIONAL`).
5. Post-calculation taxes from `hts_extra_taxes` (`POST_CALCULATION`).
6. Save into `calculation_history`.

Evidence:
- `calculation.service.ts:94-111`
- `calculation.service.ts:112-141`
- `calculation.service.ts:149-166`
- `calculation.service.ts:189`
- `calculation.service.ts:433-473`

## 3. Rate/Formula Source Precedence (Critical for Mismatch Analysis)

The exact order in `RateRetrievalService.getRate`:

1. Manual override (`hts_formula_updates`) by HTS, country, formulaType, version/carryover.
2. If request HTS starts with `99` and entryDate is in/through `2025-12-31`, use historical 2025 fallback.
3. Direct HTS formulas in this order:
   - `otherChapter99Detail.formula`
   - `otherRateFormula`
   - `adjustedFormula`
   - `rateFormula`
4. Deterministic parse fallback from text:
   - `generalRate`, then `general`, then `metadata.stagedNormalized.generalRate`.
5. Infer base formula from adjusted formula when metadata adjustment matches.
6. Knowledgebase note resolution (if service is available).
7. Historical 2025 fallback for all HTS (only when entryDate in/through `2025-12-31`).
8. Throw `No formula available for HTS ...`.

Evidence:
- `rate-retrieval.service.ts:110-130`
- `rate-retrieval.service.ts:132-148`
- `rate-retrieval.service.ts:150-193`
- `rate-retrieval.service.ts:195-211`
- `rate-retrieval.service.ts:213-239`
- `rate-retrieval.service.ts:241-257`

### 3.1 HTS hierarchy fallback (10 -> 8 -> 6)

Before selecting formula source, the HTS entry itself is resolved with ancestor fallback:

1. Build candidate digit levels (10, then 8, then 6).
2. Query best entry for each level.
3. Return first entry that has any rate/formula signal.
4. If none has usable rate/formula data, return first found entry anyway.

Evidence:
- `rate-retrieval.service.ts:260-295`
- `rate-retrieval.service.ts:297-309`
- `rate-retrieval.service.ts:341-356`

## 4. Formula Construction Logic

### 4.1 Deterministic parser (primary construction method)

Pattern coverage includes:

- Free/none/0
- Ad valorem (`5%`, `5 percent`, `5% ad valorem`)
- Compound (`x% + specific`)
- Specific (`$`, `¢`, `/unit`, `per unit`, denominators)
- Range (`5%-10%`, lower bound chosen)

Evidence:
- `formula-generation.service.ts:67-132`
- `formula-generation.service.ts:134-178`
- `formula-generation.service.ts:190-254`

### 4.2 Ambiguity guardrails

Compound parsing is blocked for known ambiguous contexts (case/strap/band/battery/movement/etc.), reducing wrong formula generation.

Evidence:
- `formula-generation.service.ts:142-144`
- `formula-generation.service.ts:256-259`

### 4.3 Unit-to-variable mapping

Mapped variables are currently limited to:

- `value`
- `weight`
- `quantity`

Evidence:
- `formula-generation.service.ts:385-479`

### 4.4 AI fallback and validator behavior

When deterministic parsing fails, AI generation is used with JSON schema validation.

Important: confidence validation now correctly accepts `0` (`typeof === 'number'`, finite, range 0..1).

Evidence:
- `formula-generation.service.ts:289-380`
- `formula-generation.service.ts:360-364`
- `formula-generation.service.ts:569-685`
- `formula-generation.service.ts:662-665`

## 5. Chapter 99 vs Reciprocal Tariff Design

### 5.1 Design boundary

`adjustedFormula` is for non-reciprocal Chapter 99 synthesis.
Reciprocal headings (`9903.01.*`) are explicitly excluded from adjusted synthesis and are expected to run through `hts_extra_taxes`.

Evidence:
- `hts-chapter99-formula.service.ts:65`
- `hts-chapter99-formula.service.ts:172-185`
- `hts-chapter99-formula.service.ts:395-408`
- `hts-chapter99-formula.service.ts:803-809`

### 5.2 Reciprocal data source

Reciprocal rows are seeded into `hts_extra_taxes` and include:

- baseline add-on row (`RECIP_BASELINE_9903_01_25`)
- conditional exception rows (`RECIP_CA_EXCEPTION_...`, `RECIP_MX_EXCEPTION_...`)
- framework country rows (`RECIP_FRAMEWORK_*`)

Evidence:
- `reciprocal-tariffs-2026.seed.ts:84-146`
- `reciprocal-tariffs-2026.seed.service.ts:20-95`

## 6. Historical 2025 Dataset Role

### 6.1 Why it exists

`hts_tariff_history_2025` is a 2025 historical math reference for 2026 operations.

Evidence:
- `hts-tariff-history-2025.entity.ts:11-13`

### 6.2 How fallback formula is built

For entry dates in/through 2025:

1. Query `hts_tariff_history_2025` by `hts8` and effective date window.
2. Build formula from numeric components (`mfnAdValRate`, `mfnSpecificRate`, `mfnOtherRate`).
3. If no numeric components, parse `mfnTextRate` deterministically.

Evidence:
- `rate-retrieval.service.ts:578-655`

### 6.3 Seed behavior

The tariff history seed is one-time:

- If marker exists or rows already exist, load is skipped.
- Marker key: `seed.tariff_history_2025.loaded`.

Evidence:
- `tariff-history-2025.seed.service.ts:19`
- `tariff-history-2025.seed.service.ts:34-50`
- `tariff-history-2025.seed.service.ts:613-638`
- `seed.service.ts:138-151`

## 7. Import-Time Formula Construction and Gate

After promotion, enrichment pipeline runs:

1. deterministic formula generation for missing general/other/adjusted formulas
2. note-based formula enrichment (if knowledgebase is available)
3. carryover manual formula overrides
4. deterministic Chapter 99 synthesis

Evidence:
- `hts-import.job-handler.ts:296-359`
- `hts-formula-generation.service.ts:24-161`
- `hts-import.job-handler.ts:511-617`
- `hts-import.job-handler.ts:382-509`
- `hts-chapter99-formula.service.ts:87-359`

Formula gate:

- coverage threshold: `HTS_MIN_FORMULA_COVERAGE` (default 0.995)
- unresolved note policy controlled by `HTS_ALLOW_UNRESOLVED_NOTE_FORMULAS`

Evidence:
- `hts-import.job-handler.ts:60-65`
- `hts-import.job-handler.ts:1603-1609`

## 8. Deep Code Review Findings (Mismatch-Relevant)

### [P2] Rate retrieval date context can diverge from tax date context

Observed behavior:

- `RateRetrievalService` historical fallback depends on `context.entryDate`.
- `CalculationService` passes `normalizedInput.entryDate` only.
- Tax calculations resolve date from broader candidate set (`FIELD_DATE_OF_LOADING`, etc.).

Impact:

- A request can apply 2025/2026 extra-tax date logic but skip 2025 historical base-rate fallback, causing inconsistent totals.

Evidence:
- `calculation.service.ts:102-109`
- `calculation.service.ts:774-790`
- `rate-retrieval.service.ts:578-589`

Recommended fix:

- Build one canonical calculation date once and pass it to both rate retrieval and tax/tariff evaluation.

### [P2] Post-calculation taxes are evaluated with pre-additional-tariff `duty`/`total` scope

Observed behavior:

- `variables.duty` and `variables.total` are set before additional tariffs are computed.
- Same variable object is used to compute post-calculation taxes.

Impact:

- Any `POST_CALCULATION` formula that depends on `duty` or `total` ignores additional tariffs.

Evidence:
- `calculation.service.ts:143-147`
- `calculation.service.ts:152-163`

Recommended fix:

- Recompute `duty`/`total` after additional tariffs before running `calculateTaxes`.

### [P3] Stage diff engine can produce false positives for array/object fields

Observed behavior:

- Diff uses `!==` for value comparison.
- Array/object fields (for example `chapter99Links`) compare by reference and appear changed even if content is equal.

Impact:

- Triage bundles can over-report `CHANGED` records and distract formula-mismatch analysis.

Evidence:
- `hts-import.job-handler.ts:2578-2582`

Recommended fix:

- Use deep equality for structured fields (same approach already used elsewhere with JSON stringify).

### [Resolved] AI confidence `0` validator bug

Observed status:

- Validator now uses explicit numeric/range checks and accepts confidence `0`.

Evidence:
- `formula-generation.service.ts:360-364`
- `formula-generation.service.ts:662-665`

## 9. Practical Mismatch Triage Checklist

### 9.1 Verify seed status first

```sql
select key, value, category
from hts_settings
where key in (
  'seed.tariff_history_2025.loaded',
  'seed.reciprocal_tariffs_2026.v2.loaded'
);

select count(*) as history_rows_2025
from hts_tariff_history_2025
where source_year = 2025;

select count(*) as reciprocal_active_rows
from hts_extra_taxes
where is_active = true
  and tax_code like 'RECIP_%';
```

### 9.2 Confirm which formula source actually executed

Use `calculation_history`:

```sql
select
  calculation_id,
  created_at,
  inputs->>'htsNumber' as hts_number,
  inputs->>'countryOfOrigin' as country,
  inputs->>'entryDate' as entry_date,
  formula_used,
  base_duty,
  additional_tariffs,
  total_taxes
from calculation_history
order by created_at desc
limit 100;
```

### 9.3 Run discrepancy harness and triage bundle scripts

- `hts-service/scripts/tariff-history-2025-api-discrepancy.ts`
- `hts-service/scripts/build-triage-bundle.ts`

These produce:

- API vs 2025 baseline mismatch report
- `1_mapped_no_formula_2026.csv`
- `2_unmapped_2025_hts8_to_active_2026.csv`
- `3_ca_mismatches_only.csv`

## 10. Summary for Guideline Usage

For mismatch investigations, always isolate the issue in this order:

1. Entry-date normalization path
2. Rate source selected by precedence
3. Formula text chosen and variable scope used
4. Additional tariff/tax policy rows matched (especially reciprocal conditions)
5. Whether a 2025 historical fallback should have been triggered
6. Whether staging/diff noise (false positives) is contaminating triage

This sequence maps directly to the runtime implementation and minimizes false root-cause attribution.

## 11. Input-Driven Formula Construction (HTS + Country)

### 11.1 Effective input contract used by the calculator

Required:

- `htsNumber`
- `countryOfOrigin`
- `declaredValue`

Context that changes source selection:

- `entryDate` (or fallback date fields in `additionalInputs`)
- `additionalInputs.chapter99Heading` / `selectedChapter99Heading` / `chapter99Headings` / `chapter99Selections`
- `htsVersion`

Evidence:

- `packages/calculator/src/services/calculation.service.ts:94-116`
- `packages/calculator/src/services/calculation.service.ts:678-737`
- `packages/calculator/src/services/rate-retrieval.service.ts:38-110`

### 11.2 Country impacts formula path in two places

1. Base-rate branch selection in `RateRetrievalService`:
- Non-NTR countries (fallback includes `RU`) route to `OTHER` / `OTHER_CHAPTER99` branches.
- Chapter 99 adjusted branch is only eligible if:
  - country is eligible, and
  - reciprocal-only marker is false, and
  - caller explicitly selected a linked Chapter 99 heading.

Evidence:

- `packages/calculator/src/services/rate-retrieval.service.ts:63-109`
- `packages/calculator/src/services/rate-retrieval.service.ts:152-183`
- `packages/calculator/src/services/rate-retrieval.service.ts:359-365`

2. Additional tariffs/taxes in `hts_extra_taxes`:
- Country matching supports exact code, `ALL`, and regional `EU`.
- Policy conditions can whitelist/blacklist countries and require chapter99 heading selections.

Evidence:

- `packages/calculator/src/services/calculation.service.ts:544-576`
- `packages/calculator/src/services/calculation.service.ts:578-676`
- `packages/calculator/src/services/calculation.service.ts:871-890`

### 11.3 End-to-end precedence (concise)

For a request `{ htsNumber, countryOfOrigin, entryDate }`, formula source is resolved by:

1. Normalize input/date/chapter99 selections.
2. Resolve HTS entry with hierarchy fallback (`10 -> 8 -> 6` digits).
3. Evaluate manual overrides by formula type and country.
4. Evaluate direct formulas (`otherChapter99 -> other -> adjusted -> general`).
5. Deterministic parse from rate text.
6. Knowledgebase note resolution (if needed).
7. Historical 2025 fallback (date-gated).

Evidence:

- `packages/calculator/src/services/calculation.service.ts:98-116`
- `packages/calculator/src/services/rate-retrieval.service.ts:111-258`
- `packages/calculator/src/services/rate-retrieval.service.ts:261-310`

## 12. Generated HTS Input Lists (20 per Chapter, Major Countries)

To satisfy coverage requests for HTS + country test inputs, a generated dataset is included.

Data source:

- `.tmp/usitc/tariff_database_2025.txt`

Major country set used:

- `CN`, `CA`, `EU`, `JP`, `RU`

Generated outputs:

- `docs/reports/formula-input-matrix-20260218/hts-chapter-samples-20-per-chapter.csv`
- `docs/reports/formula-input-matrix-20260218/hts-major-country-input-matrix.csv`
- `docs/reports/formula-input-matrix-20260218/summary.json`
- `docs/reports/formula-input-matrix-20260218/README.md`

Generation script:

- `scripts/generate-hts-formula-input-matrix.ts`

Run command:

```bash
npx ts-node -P ./tsconfig.json -r tsconfig-paths/register ./scripts/generate-hts-formula-input-matrix.ts
```

Current generation stats:

- Chapters covered: `98` (chapter `77` has no rows in the 2025 file)
- HTS samples selected: `1887`
- Country matrix rows: `9435`

Notes:

- Target is 20 codes/chapter where available; some chapters have fewer than 20 legal lines in the source file.
- Matrix rows are ready-to-use API payload examples (`htsNumber`, `countryOfOrigin`, `entryDate`, `declaredValue`).
