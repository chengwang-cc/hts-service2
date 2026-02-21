# 2025 Tariff History Table Design (2026 Reference)

## 1) Goal

Create a one-time, computation-ready historical dataset from `tariff_database_2025.txt` that:

- preserves the original 2025 USITC tariff row shape,
- exposes math-friendly duty components (ad valorem, specific, other),
- can be seeded exactly once and reused during 2026 calculations/reconciliation.

This table is **reference history** and is not the live HTS source of truth.

## 2) Source Inputs

- Tariff file: `tariff_data_2025.zip` -> `tariff_database_2025.txt`
- Field dictionary: `td-fields.pdf`

Validated structure from source file:

- 122 columns
- 13,100 data rows (plus 1 header row)
- CSV with quoted fields and CRLF line endings

## 3) Field Strategy

The source has many program-specific columns (GSP, CBI, CBTPA, Jordan, Korea, USMCA, etc.).  
To keep strong queryability without creating a brittle 122-column table, the design is:

- **Core scalar columns** for primary lookup and rate math (`hts8`, dates, MFN, COL2, units, special text, notes).
- **`preference_programs` JSONB** for indicator-centric program flags.
- **`math_components` JSONB** for normalized computational components used by formula construction.
- **`raw_row` JSONB** to keep all 122 original columns with full fidelity.

This allows:

- deterministic historical replays,
- easy future remapping if formula logic evolves,
- full traceability back to the official 2025 row.

### 3.1) CSV Column Groups (122 Fields)

The 122 source columns are grouped as:

- Product identity: `hts8`, `brief_description`
- Quantity keys: `quantity_1_code`, `quantity_2_code`
- WTO/MFN: `wto_binding_code`, `mfn_text_rate`, `mfn_rate_type_code`, `mfn_ave`, `mfn_ad_val_rate`, `mfn_specific_rate`, `mfn_other_rate`
- Column 1 special text: `col1_special_text`, `col1_special_mod`
- Preference program indicators and rates:
  - `gsp_*`, `apta_indicator`, `civil_air_indicator`
  - `nafta_canada_ind`, `nafta_mexico_ind`, `mexico_*`
  - `cbi_*`, `agoa_indicator`, `cbtpa_*`
  - `israel_fta_indicator`, `atpa_*`, `atpdea_indicator`
  - `jordan_*`, `singapore_*`, `chile_*`, `morocco_*`, `australia_*`, `bahrain_*`
  - `dr_cafta_*`, `dr_cafta_plus_*`, `oman_*`, `peru_*`
  - `korea_*`, `colombia_*`, `panama_*`, `japan_*`, `usmca_*`
  - `nepal_indicator`, `pharmaceutical_ind`, `dyes_indicator`
- Column 2: `col2_text_rate`, `col2_rate_type_code`, `col2_ad_val_rate`, `col2_specific_rate`, `col2_other_rate`
- Effective window and notes: `begin_effect_date`, `end_effective_date`, `footnote_comment`, `additional_duty`

`raw_row` keeps all these fields exactly as imported so no source detail is lost.

## 4) New Table

Table name: `hts_tariff_history_2025`

Key columns:

- `source_year`, `source_dataset`
- `hts8`, `brief_description`
- `quantity_1_code`, `quantity_2_code`, `wto_binding_code`
- `mfn_text_rate`, `mfn_rate_type_code`, `mfn_ad_val_rate`, `mfn_specific_rate`, `mfn_other_rate`
- `col1_special_text`, `col1_special_mod`
- `col2_text_rate`, `col2_rate_type_code`, `col2_ad_val_rate`, `col2_specific_rate`, `col2_other_rate`
- `begin_effect_date`, `end_effective_date`
- `footnote_comment`, `additional_duty`
- `pharmaceutical_indicator`, `dyes_indicator`, `nepal_indicator`
- `preference_programs` (JSONB)
- `math_components` (JSONB)
- `raw_row` (JSONB)
- `row_hash`, `is_2026_reference`
- `created_at`, `updated_at`

Indexes:

- unique natural key: `(source_year, hts8, begin_effect_date, end_effective_date)`
- unique hash key: `(source_year, row_hash)`
- lookup indexes: `hts8`, `source_year`, `end_effective_date`
- GIN index on `math_components`

## 5) Math Component Shape

`math_components` stores decomposed calculation parts per rate block:

- `mfn`: text + rate type + component list
- `col2`: text + rate type + component list
- `programs.<program>`: same normalized structure for program rates

Each component entry uses:

- `type`: `ad_valorem` | `specific` | `other`
- `variable`: `value` | `quantity_1` | `quantity_2`
- `rate`: numeric component from CSV
- `unitCode`: quantity code (for specific/other where applicable)

This structure is intentionally neutral and auditable; final executable formulas can be generated downstream with clearer variable semantics.

## 6) Seed Design (One-Time Load)

Service: `TariffHistory2025SeedService`

Behavior:

1. Checks `hts_settings.key = "seed.tariff_history_2025.loaded"`.
2. Checks whether rows already exist for `source_year = 2025`.
3. If already loaded, skips safely.
4. If not loaded, parses the CSV stream and upserts in batches.
5. Writes load metadata to `hts_settings` and marks load complete.

Seed command:

```bash
npm run db:seed -- TariffHistory2025
```

Optional file override:

```bash
TARIFF_DATABASE_2025_FILE=/absolute/path/tariff_database_2025.txt npm run db:seed -- TariffHistory2025
```

Default lookup paths:

- `<hts-service>/.tmp/usitc/tariff_database_2025.txt`
- `<hts-service>/.tmp/tariff_database_2025.txt`
- `<hts-service>/tariff_database_2025.txt`
- `<repo>/hts-docs/tariff_database_2025.txt`

## 7) 2026 Usage Notes

- Use `hts_tariff_history_2025` as an auxiliary historical math reference.
- Keep runtime/live classification and revisions from `hts_<year>_revision_<rev>_json.json` in the current `hts` table.
- Join historical reference by `hts8` + effective window when you need:
  - backtesting formulas,
  - validating parsed rates,
  - reconciling missing math fields in live revision feeds.

## 8) Out of Scope

- This seed does not replace live USITC import flows.
- This seed does not auto-refresh yearly datasets.
- This seed is intentionally constrained to one historical 2025 load for 2026 operations.
