# Mismatch Isolation and Ranked Remediation (2026-02-18)

## Scope
- Source CSV: `/Users/cheng/projects/cc/hts/hts-service/docs/reports/tariff-history-2025-vs-api-2026-2026-02-18T03-49-47-181Z.csv`
- Total rows: 13,100
- Mismatch rows: 10,071
- `api_error_422` rows: 145

## Isolated Root Pattern
All 10,071 mismatches are from `api_rate_source = adjusted` and are dominated by adjusted formulas adding a Chapter 99 surcharge term.

### Mismatch by trailing adjusted add-on rate
- `+ (value * 0.25)`: 7,318 rows (72.66%), avg `abs_delta` = 25.00
- `+ (value * 0.075)`: 2,722 rows (27.03%), avg `abs_delta` = 7.50
- `+ (value * 0.5)`: 20 rows (0.20%), avg `abs_delta` = 50.00
- `+ (value * 1)`: 11 rows (0.11%), avg `abs_delta` = 100.00

### Top Chapter 99 links driving mismatches (join via `metadata.chapter99Synthesis.selectedChapter99`)
- `9903.88.03` @ `0.25`: 5,816 mismatch rows
- `9903.88.15` @ `0.075`: 2,722 mismatch rows
- `9903.88.01` @ `0.25`: 856 mismatch rows
- `9903.91.01` @ `0.25`: 347 mismatch rows
- `9903.88.02` @ `0.25`: 281 mismatch rows
- Remaining headings combined: 49 mismatch rows

## `api_error_422` Isolation (145 rows)
All are `No formula available for HTS ...` and cluster mostly in these chapters:
- Chapter 91: 89
- Chapter 17: 12
- Chapter 62: 11
- Chapter 61: 10
- Chapter 82: 5
- Others: 18

## Ranked Remediation List

1. Gate `adjustedFormula` application by explicit Chapter 99 selection in calculator requests.
- Expected impact: addresses the dominant 10,071-row mismatch class.
- Why: current runtime auto-applies adjusted formulas for eligible country lists even without explicit heading selection.

2. Add a historical comparison mode for entry dates `<= 2025-12-31` to prioritize 2025 historical base duty over 2026 adjusted surcharges unless explicitly requested.
- Expected impact: removes backtest inflation in 2025-vs-2026 baseline comparisons.
- Why: current precedence uses adjusted formula before historical fallback when adjusted exists.

3. Normalize Chapter 99 surcharge handling into `hts_extra_taxes` (add-on layer) for comparison workflows that need MFN base duty isolation.
- Expected impact: clearer base-vs-surcharge decomposition and fewer false mismatch flags.
- Why: adjusted formulas currently blend base and Chapter 99 surcharge into one expression.

4. Close 145 unresolved formula gaps (`api_error_422`) via targeted carryover/manual overrides and/or deterministic parsing improvements in chapters 91/17/62/61 first.
- Expected impact: directly reduces hard-failure rows.
- Why: these rows are currently blocking calculation entirely.
