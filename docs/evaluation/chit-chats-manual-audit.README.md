# Chit Chats Manual Audit

Primary file:
- `docs/evaluation/chit-chats-manual-audit.csv`

Purpose:
- Create a defensible gold subset from `chit-chats-live-eval.csv`
- Prioritize rows where the current label is risky and the live `/lookup/search` result disagrees

How rows are prioritized:
- `top10_miss`: live search did not return the expected code in top 10
- `top1_mismatch`: live search top 1 disagrees with the current expected code
- `multi_label`: the same normalized query maps to multiple HTS codes in the source data
- `high_noise` / `moderate_noise`: the source description still contains catalog noise
- `multi_source` / `many_contributors`: multiple standardized rows contributed to the same query
- `high_value_chapter_*`: apparel, bags, jewelry, electronics, and similar chapters where search mistakes are expensive

Reviewer workflow:
1. Read `standardized_query` and `representative_description`
2. Compare `expected_hts_number` and `expected_hts_path`
3. Compare the live evidence: `live_top1_hts_number`, `live_top1_description`, `live_top10_hts_numbers`
4. Decide whether the current expected code is correct
5. Update:
   - `audit_status`: `CONFIRMED`, `CORRECTED`, or `SKIP`
   - `audited_hts_number`
   - `audited_description`
   - `reviewer_notes`

Recommended first-pass rule:
- If the query is too broad to support a reliable 10-digit code, mark `SKIP`
- If the query clearly identifies the article/material/use and the current label is correct, mark `CONFIRMED`
- If the source label is wrong, mark `CORRECTED` and fill the corrected code and description

Recommended first review bucket:
- Start with the top 100 rows by `priority_score`
- Then review all rows flagged `multi_label`
- Then review apparel (`61`, `62`, `64`), bags (`42`), jewelry (`71`), and electronics (`85`)
