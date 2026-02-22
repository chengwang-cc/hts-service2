# HTS Lookup Refactor and Improvement Plan

Date: 2026-02-22  
Service: `hts-service`  
Scope endpoints:
1. `GET /api/v1/lookup/autocomplete`
2. `POST /api/v1/lookup/search`
3. `POST /api/v1/lookup/classify`

## 1. Objective

Improve relevance accuracy, stability, and latency for lookup endpoints, with special focus on mixed-intent text queries (example: `transformer comic book`) and AI-assisted classification quality.

Primary goals:
1. Increase top-result relevance for autocomplete and search.
2. Improve classification top-1 correctness for difficult product descriptions.
3. Remove infrastructure bottlenecks that currently force sequential scans.
4. Add measurable evaluation and regression safeguards.

## 2. Current State (Validated)

## 2.1 Retrieval columns and methods

`autocomplete`:
1. Numeric/code query path: `hts.hts_number` (`ILIKE`, normalized digits).
2. Text query path: `hts.search_vector` using `to_tsquery` + `ts_rank_cd`.
3. Returned fields: `hts_number`, `description`, `chapter`, `indent`.

`search`:
1. Semantic path: `hts.embedding` with cosine similarity (`<=>`).
2. Keyword path: `hts.search_vector` full-text ranking.
3. Hybrid merge: weighted score combination of semantic and keyword lists.

`classify`:
1. Candidate retrieval from `hts.search_vector` + `hts.embedding`.
2. AI heading prediction and AI final leaf selection.
3. Uses `full_description` in prompt context where available.

## 2.2 Critical schema/index findings

Database checks on `hts` found:
1. No `search_vector` index.
2. No vector ANN index for `embedding`.
3. Query plans for both FTS and vector retrieval are sequential scans.

Observed impact:
1. FTS query plans perform `Seq Scan` on full `hts` table.
2. Vector similarity query performs `Seq Scan` and sort over large candidate sets.

## 2.3 Accuracy behavior observed

Representative query: `transformer comic book`

`autocomplete`:
1. Returns mostly Chapter 48 notebook/book records.
2. Misses comic-periodical intent in top positions.

`search`:
1. Similar to autocomplete, top results dominated by book/notebook lexical matches.
2. Weak handling of mixed-intent query terms.

`classify`:
1. Currently returns plausible 4902 leaf in tested run.
2. Retrieval evidence quality is inconsistent, so AI correctness is less robust than it should be.

## 3. Root Causes

1. Missing FTS and vector indexes reduce headroom and constrain ranking complexity.
2. OR-fallback lexical queries over-weight frequent stems and generic tokens.
3. `autocomplete` text path is purely lexical and lacks semantic rescue for sparse vocabulary.
4. Mixed-intent query logic does not enforce sufficient multi-token coverage in top ranks.
5. Classification leaf resolution accepts weak lexical candidates (including many low-information rows).
6. No endpoint-level relevance regression suite for lookup endpoints.

## 4. Refactor Strategy

Four workstreams will be executed in sequence:
1. Data and index foundation.
2. Retrieval and ranking quality for `autocomplete` and `search`.
3. AI-assisted classification hardening.
4. Evaluation, observability, and regression controls.

## 5. Phased Plan

## Phase 0: Baseline and Evaluation Harness (1-2 days)

Deliverables:
1. Curated labeled query set (200-500 queries).
2. Endpoint-specific relevance metrics:
   - `autocomplete`: MRR, Hit@5.
   - `search`: nDCG@10, Hit@3, chapter accuracy.
   - `classify`: top-1 accuracy, chapter accuracy, calibration curve.
3. Query-runner script for repeatable benchmark runs in local/staging.

Acceptance:
1. Baseline metrics generated and committed in report document.
2. Re-run deterministically without manual query edits.

## Phase 1: Schema and Performance Foundation (1-2 days)

Deliverables:
1. Migration: create GIN index for `hts.search_vector`.
2. Migration: create pgvector ANN index (HNSW preferred, IVFFLAT fallback) on `hts.embedding` where non-null.
3. Post-migration maintenance:
   - `ANALYZE hts`
   - verify query plans now use indexes.
4. Embedding refresh run to ensure canonical search text is current.

Acceptance:
1. `EXPLAIN ANALYZE` shows index-backed plans for FTS and vector retrieval.
2. P95 latency improves from baseline.

## Phase 2: `autocomplete` and `search` Ranking Improvements (3-5 days)

Deliverables:
1. Query-intent classifier:
   - `code`
   - `text`
   - `mixed`
2. `autocomplete` hybrid retrieval for text/mixed intents:
   - lexical FTS candidates
   - semantic candidates
   - rank fusion (RRF).
3. Replace current OR fallback with token-coverage-aware reranking:
   - for multi-word queries, prioritize candidates matching at least two distinct query terms.
4. Generic-label penalty:
   - down-rank rows where leaf label is only `Other` unless parent context strongly matches.
5. Add lexical normalization and domain synonym expansion:
   - examples: `comic -> periodical`, `manga -> comic periodical`.
6. Chapter diversity guard in top results for broad text queries.

Acceptance:
1. `autocomplete` MRR improves by target threshold.
2. `search` nDCG@10 improves by target threshold.
3. Regression suite passes with no severe degradations in code-query behavior.

## Phase 3: `classify` (AI-assisted) Hardening (3-5 days)

Deliverables:
1. Strengthen leaf-candidate retrieval:
   - require meaningful lexical/semantic evidence, not raw prefix-only fill.
2. Add semantic leaf fallback inside chosen heading/subheading scope.
3. Use evidence features in final AI decision prompt:
   - lexical token coverage
   - semantic similarity
   - hierarchy specificity
4. Model-routing policy:
   - default lightweight model for low-complexity cases.
   - escalate to stronger model for low-confidence or ambiguous cases.
5. Confidence gating:
   - return top-3 with `needsReview` when confidence below threshold.
6. Deterministic post-rules for known confusion groups.

Acceptance:
1. Classification top-1 improves against baseline.
2. Low-confidence cases are explicitly surfaced instead of overconfident misclassification.

## Phase 4: Continuous Quality and Operations (ongoing)

Deliverables:
1. Nightly relevance regression run.
2. Dashboard for:
   - accuracy metrics by endpoint
   - latency and error rates
   - confidence distributions
3. Feedback loop:
   - ingest confirmed user choices into synonym/reranker tuning queue.

Acceptance:
1. No silent drift for 2 consecutive weekly runs.
2. Alerting on metric drops over agreed threshold.

## 6. Endpoint-Specific Refactor Checklist

## 6.1 `/lookup/autocomplete`

1. Keep code-prefix path strict and fast.
2. For text queries, add semantic fallback and RRF fusion.
3. Enforce multi-token coverage for top ranks.
4. Penalize generic leaves without matching hierarchy evidence.

## 6.2 `/lookup/search`

1. Keep hybrid retrieval.
2. Improve merge scoring with coverage and specificity signals.
3. Add optional chapter-intent bias for domain-specific terms.
4. Expose debug metadata internally for ranking analysis.

## 6.3 `/lookup/classify`

1. Improve candidate quality before AI selection.
2. Add semantic scoped leaf retrieval.
3. Add confidence gating and escalation path.
4. Add targeted tests for known difficult products:
   - comic book/manga
   - transformer-related products
   - close lexical confusions with different HTS intent.

## 7. Testing Plan

Unit tests:
1. Intent classification and token coverage scorer.
2. Rank fusion behavior.
3. Generic-label penalty logic.
4. Confidence-gating logic.

Integration tests:
1. Endpoint output consistency.
2. Query families with expected top-N containment.

E2E tests:
1. `autocomplete` and `search` relevance checks with fixed fixtures.
2. Add first dedicated `lookup/classify` e2e coverage.

Performance tests:
1. Before/after latency and throughput under representative query mix.
2. Verify no regressions for HTS code-prefix autocomplete.

## 8. Success Metrics (Initial Targets)

1. `autocomplete`:
   - MRR +25% versus baseline.
   - Hit@5 +20% for text queries.
2. `search`:
   - nDCG@10 +20%.
   - Chapter accuracy in top-3 +15%.
3. `classify`:
   - Top-1 code accuracy +10%.
   - Chapter accuracy +12%.
   - Reduce low-quality high-confidence outputs by 30%.
4. Performance:
   - FTS P95 latency improvement by at least 40% post-index.
   - Semantic retrieval P95 improvement by at least 50% post-vector index.

## 9. Risks and Mitigations

1. Risk: Index build impact on production write load.  
   Mitigation: build concurrently in off-peak window, verify lock behavior.

2. Risk: Overfitting ranking to small benchmark set.  
   Mitigation: holdout query set and weekly drift checks.

3. Risk: AI model variability causing output drift.  
   Mitigation: deterministic fallback and confidence thresholds.

4. Risk: Synonym expansion introducing false positives.  
   Mitigation: weighted synonym confidence and ablation tests.

## 10. Execution Order Recommendation

1. Phase 0 (baseline harness).
2. Phase 1 (indexes + plan verification).
3. Phase 2 (autocomplete/search relevance).
4. Phase 3 (classification hardening).
5. Phase 4 (continuous monitoring).

This order minimizes risk and ensures accuracy tuning is measured against a stable, performant retrieval layer.

## 11. Evaluation Set and Smoke Automation (Implemented)

The following artifacts are now part of the repository:

1. Evaluation set file (JSONL):
   - `docs/evaluation/lookup-evaluation-set-v1.jsonl`
2. Evaluation set generator (500-1000 labeled rows, each with expected HTS):
   - `scripts/generate-lookup-evaluation-set.ts`
3. Smoke accuracy runner:
   - `scripts/lookup-accuracy-smoke.ts`
4. Evaluation-set structural validator:
   - `scripts/validate-lookup-evaluation-set.ts`
5. NPM commands:
   - `npm run lookup:eval:generate`
   - `npm run lookup:eval:validate`
   - `npm run lookup:eval:smoke`
6. Post-promotion integration:
   - `HtsImportJobHandler.runPostPromotionEnrichment` now triggers lookup smoke evaluation after staged promotion enrichment.

Evaluation row schema (v1, backward compatible):

1. `expectedHtsNumber`: canonical single label
2. `acceptableHtsNumbers` (optional): multi-label acceptance for ambiguous queries
3. `expectedChapter` / `acceptableChapters` (optional): chapter-level tolerance
4. `ambiguity` (optional): ambiguity marker (for now: `multi_label`)

Quality safeguards added:

1. Generator now collapses duplicate normalized queries into one row and stores all acceptable labels in `acceptableHtsNumbers`.
2. Generator skips known low-information queries (e.g. `other`) to reduce noisy labels.
3. Smoke evaluator uses `acceptableHtsNumbers` when present instead of forcing single-label exact match.
4. Smoke evaluator automatically removes `classify` endpoint on ambiguous rows (multi-label rows should not be used as strict classify truth).
5. Validator checks:
   - duplicate query mappings
   - malformed/missing labels
   - ambiguous rows incorrectly tagged for classify
   - optional active-HTS existence against DB
   - comic/periodical disambiguation warning when query text is underspecified

Runtime controls (environment variables):

1. `HTS_LOOKUP_SMOKE_ON_PROMOTION` (`true|false`, default `true`)
2. `HTS_LOOKUP_EVAL_SET_PATH` (default `docs/evaluation/lookup-evaluation-set-v1.jsonl`)
3. `HTS_LOOKUP_SMOKE_SAMPLE_SIZE` (default `200`)
4. `HTS_LOOKUP_SMOKE_CLASSIFY_SAMPLE_SIZE` (default `50`)
5. `HTS_LOOKUP_SMOKE_RESULT_LIMIT` (default `10`)

## 12. Advanced Conversation Mode (Design Added)

For advanced/power users, a conversation-style experience is designed separately using OpenAI Agent SDK + MCP tools:

1. Design document:
   - `docs/lookup-conversation-agent-design-2026-02-22.md`
2. Scope:
   - Multi-turn clarification, ambiguity handling, evidence-backed HTS recommendation, scenario comparison.
3. Architecture:
   - Conversation API + Agent SDK orchestration + Lookup/Evidence/Calculator MCP tool servers.
4. Safety:
   - Read-only lookup tools, tool allowlist, prompt-injection hardening, confidence/clarification gating.
5. Evaluation:
   - Dedicated conversation eval set with ambiguity and adversarial cases.
