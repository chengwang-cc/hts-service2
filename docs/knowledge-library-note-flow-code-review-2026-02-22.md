# Knowledge Library Deep Code Review: PDF Note Parsing, HTS Lookup/Calculation Usage, and HTS UI Reference Path

Date: 2026-02-22  
Repository: `hts-service` + `hts-ui`  
Scope: knowledge library ingestion, note extraction/resolution, formula enrichment, lookup/calculator runtime usage, and HTS detail page reference behavior.

## Update (Implemented Fixes on 2026-02-22)

The following issues from this review have been addressed in code:

1. Reindex parsing for `CHAPTER`/`GENERAL` document types now uses PDF handling.
2. Semantic note resolution now performs top-K selection with chapter/year filtering and chapter `00` fallback.
3. Exact note resolution now supports chapter `00` fallback.
4. Backfill unresolved-target SQL now checks note `year` and chapter fallback (`target` or `00`).
5. `POST /knowledgebase/notes/search` now accepts HTS context correctly (`htsNumber`) and no longer misuses chapter as HTS number.
6. Added `GET /lookup/hts/:htsNumber/notes` for internal note references and wired `hts-ui` HTS detail page to display internal notes.
7. Chunk embedding generation now uses real OpenAI embeddings instead of placeholder zero-vectors.
8. Public knowledgebase query/recommend endpoints now include knowledge-library note/chunk matches in responses.

For the current operational flow, see:

- `docs/knowledge-library-notes-lookup-calculation-flow-2026-02-22.md`

## 1. What Was Reviewed

### Backend (`hts-service`)
- `src/modules/knowledgebase/knowledgebase.module.ts`
- `src/modules/knowledgebase/services/pdf-parser.service.ts`
- `src/modules/knowledgebase/services/note-extraction.service.ts`
- `src/modules/knowledgebase/services/note-resolution.service.ts`
- `src/modules/knowledgebase/services/document.service.ts`
- `src/modules/knowledgebase/services/note-embedding-generation.service.ts`
- `src/modules/knowledgebase/entities/*.ts`
- `src/modules/knowledgebase/controllers/knowledgebase.controller.ts`
- `src/modules/admin/jobs/document-processing.job-handler.ts`
- `src/modules/admin/jobs/hts-import.job-handler.ts` (note-related sections)
- `src/modules/admin/services/knowledge.admin.service.ts`
- `src/modules/admin/controllers/knowledge.admin.controller.ts`
- `src/modules/lookup/services/search.service.ts`
- `src/modules/lookup/controllers/lookup.controller.ts`
- `src/modules/calculator/services/rate-retrieval.service.ts`
- `src/modules/calculator/services/calculation.service.ts`
- `src/modules/public-api/v1/controllers/knowledgebase-public.controller.ts`

### Frontend (`hts-ui`)
- `projects/website/src/app/services/hts-search.service.ts`
- `projects/website/src/app/features/hts/pages/hts-detail.page.ts`
- `projects/admin/src/app/features/knowledge/services/knowledge.service.ts`
- `projects/admin/src/app/features/knowledge/pages/knowledge-library.page.ts`

## 2. End-to-End Architecture: How Knowledge Library Works

## 2.1 Ingestion Entry Points

1. Admin upload/import endpoint: `POST /admin/knowledge/documents`  
   - Implemented by `KnowledgeAdminController` and `KnowledgeAdminService`.
2. Two main import modes:
   - `version="latest"` (auto-detect latest USITC revision)
   - specific `year + revision`
3. Optional chapter-targeted note backfill:
   - `POST /admin/knowledge/notes/backfill/preview`
   - `POST /admin/knowledge/notes/backfill/apply`

Relevant code:
- `src/modules/admin/controllers/knowledge.admin.controller.ts:84`
- `src/modules/admin/services/knowledge.admin.service.ts:77`
- `src/modules/admin/services/knowledge.admin.service.ts:370`

## 2.2 Processing Pipeline

For admin-uploaded documents, queue job `document-processing` runs:

1. `DOWNLOADING`: load from DB PDF blob or URL and upload to S3.
2. `PARSING`: parse PDF text via `PdfParserService` (`pdftotext`) or read text stream.
3. `EXTRACTING_NOTES`: parse text into HTS notes and persist in `hts_notes` (+ rates + note embeddings).
4. `CHUNKING`: chunk parsed text into `knowledge_chunks` rows.
5. `COMPLETED`: mark document done and enqueue `embedding-generation` for chunks.

Relevant code:
- `src/modules/admin/jobs/document-processing.job-handler.ts:96`
- `src/modules/admin/jobs/document-processing.job-handler.ts:259`
- `src/modules/admin/jobs/document-processing.job-handler.ts:329`
- `src/modules/admin/jobs/document-processing.job-handler.ts:386`
- `src/modules/admin/jobs/document-processing.job-handler.ts:140`

## 2.3 PDF Parsing Details

`PdfParserService.parsePdf` behavior:
- Writes temp `input.pdf`
- Runs `pdftotext -layout -nopgbrk -enc UTF-8`
- Validates non-empty and minimal length
- Cleans up temp directory

Relevant code:
- `src/modules/knowledgebase/services/pdf-parser.service.ts:15`
- `src/modules/knowledgebase/services/pdf-parser.service.ts:52`
- `src/modules/knowledgebase/services/pdf-parser.service.ts:70`

Section splitter (`extractSections`) detects:
- GENERAL NOTES
- ADDITIONAL U.S. NOTES
- STATISTICAL NOTES
- SECTION NOTES
- CHAPTER NOTES

Relevant code:
- `src/modules/knowledgebase/services/pdf-parser.service.ts:82`

## 2.4 Note Extraction Logic

`NoteExtractionService.extractNotes` flow:

1. Idempotency for same document: delete existing notes by `documentId`.
2. If text very large (`>= 1,000,000 chars`): skip section splitting and treat as `CHAPTER_NOTE` blob.
3. Else split into sections and extract per section type.

Per section extraction (`extractNotesFromSection`):
1. Regex-first extraction (fast path).
2. If regex fails: chunk text and LLM extraction (`gpt-4o`, JSON schema, up to 5 chunks).
3. If still empty: deterministic fallback note from first content slice.
4. Dedupe selected note candidates by score/length.
5. Upsert note by (`year`, `chapter`, `noteType`, `noteNumber`).
6. Extract rate formulas:
   - deterministic pattern first (`FormulaGenerationService.generateFormulaByPattern`)
   - optional LLM fallback for unresolved explicit rate text
7. Generate per-note embedding (`NoteEmbeddingGenerationService.generateSingleEmbedding`).

Relevant code:
- `src/modules/knowledgebase/services/note-extraction.service.ts:36`
- `src/modules/knowledgebase/services/note-extraction.service.ts:90`
- `src/modules/knowledgebase/services/note-extraction.service.ts:527`
- `src/modules/knowledgebase/services/note-extraction.service.ts:293`
- `src/modules/knowledgebase/services/note-extraction.service.ts:239`
- `src/modules/knowledgebase/services/note-extraction.service.ts:390`

## 2.5 Data Model

Primary entities:
- `hts_documents`: source docs, parsing/checkpoint status, S3 refs.
- `hts_notes`: extracted notes (chapter/year/type/number/content).
- `hts_note_rates`: rate text -> formula + variables + confidence.
- `hts_note_embeddings`: vector for semantic note resolution.
- `hts_note_references`: audit trail of note resolution attempts for HTS rate text references.
- `knowledge_chunks`: chunked document text + optional chunk embedding.

Relevant code:
- `src/modules/knowledgebase/entities/hts-document.entity.ts`
- `src/modules/knowledgebase/entities/hts-note.entity.ts`
- `src/modules/knowledgebase/entities/hts-note-rate.entity.ts`
- `src/modules/knowledgebase/entities/hts-note-embedding.entity.ts`
- `src/modules/knowledgebase/entities/hts-note-reference.entity.ts`
- `src/modules/knowledgebase/entities/knowledge-chunk.entity.ts`

## 3. How Notes Are Used for HTS Lookup and Calculation

## 3.1 Import-Time Formula Enrichment (HTS Table)

During HTS import promotion, if rate text references notes and formula is missing:
- resolve note reference via `NoteResolutionService`
- write resolved formula into `hts.rateFormula` / `hts.otherRateFormula`
- store flags in metadata

Relevant code:
- `src/modules/admin/jobs/hts-import.job-handler.ts:570`
- `src/modules/admin/jobs/hts-import.job-handler.ts:623`
- `src/modules/admin/jobs/hts-import.job-handler.ts:649`

Validation gate also checks whether note-based rates are resolvable before promotion.

Relevant code:
- `src/modules/admin/jobs/hts-import.job-handler.ts:1806`
- `src/modules/admin/jobs/hts-import.job-handler.ts:1866`
- `src/modules/admin/jobs/hts-import.job-handler.ts:1734`

## 3.2 Runtime Calculation Path

`RateRetrievalService.getRate` precedence (simplified):
1. manual override
2. historical 2025 special fallback
3. direct HTS formulas (`otherChapter99`, `other`, `adjusted`, `general`)
4. deterministic parse from textual rate
5. inferred base from adjusted
6. knowledgebase note resolution if rate text contains "note"
7. historical fallback

If knowledgebase resolution succeeds, source becomes `knowledgebase` and formula is used for duty evaluation.

Relevant code:
- `src/modules/calculator/services/rate-retrieval.service.ts:119`
- `src/modules/calculator/services/rate-retrieval.service.ts:231`
- `src/modules/calculator/services/rate-retrieval.service.ts:246`

`CalculationService` then evaluates returned formula and computes duties/taxes.

Relevant code:
- `src/modules/calculator/services/calculation.service.ts:108`
- `src/modules/calculator/services/calculation.service.ts:147`

## 3.3 Lookup Path

Lookup/search itself does not query note tables directly:
- `SearchService.hybridSearch` uses HTS table vectors + FTS, not `hts_notes`.
- `GET /lookup/hts/:htsNumber` returns HTS row fields (including formulas if enriched previously), not note content.

Relevant code:
- `src/modules/lookup/services/search.service.ts:17`
- `src/modules/lookup/services/search.service.ts:370`
- `src/modules/lookup/controllers/lookup.controller.ts:87`

Net effect: notes impact lookup **indirectly** only when formulas were copied into HTS fields during import/enrichment.

## 4. HTS UI Detail Page: How Notes Are Referenced

Current behavior in `hts-ui` website:
- HTS detail page loads from `/lookup/hts/:htsNumber`.
- Page renders rates/metadata from HTS record.
- "Chapter Notes" button opens USITC chapter endpoint in a new tab.
- No in-app API call to load internal `hts_notes` content.

Relevant code:
- `hts-ui/projects/website/src/app/services/hts-search.service.ts:103`
- `hts-ui/projects/website/src/app/features/hts/pages/hts-detail.page.ts:118`
- `hts-ui/projects/website/src/app/features/hts/pages/hts-detail.page.ts:331`

## 5. Deep Code Review Findings (Prioritized)

## [P1] Reindex pipeline can mis-handle CHAPTER/GENERAL documents as text, breaking PDF reprocessing

- `DocumentService.downloadDocument` stores chapter downloads with `documentType = 'CHAPTER'|'GENERAL'`, even though payload is PDF.
- `DocumentProcessingJobHandler` treats only `documentType === 'PDF'` as PDF during S3 upload and parse stages.
- On reindex/reprocess, chapter docs can be uploaded/parsing as text (`.txt` + utf8 read), causing parse/note extraction failure.

Evidence:
- `src/modules/knowledgebase/services/document.service.ts:84`
- `src/modules/admin/jobs/document-processing.job-handler.ts:210`
- `src/modules/admin/jobs/document-processing.job-handler.ts:287`

## [P1] “Knowledgebase” public query/recommend endpoints do not use knowledge notes/chunks

- Endpoints call HTS `SearchService.hybridSearch` only.
- `DocumentService` is injected but unused.
- This does not provide chapter-note retrieval/resolution semantics expected from knowledgebase naming.

Evidence:
- `src/modules/public-api/v1/controllers/knowledgebase-public.controller.ts:92`
- `src/modules/public-api/v1/controllers/knowledgebase-public.controller.ts:169`
- `src/modules/public-api/v1/controllers/knowledgebase-public.controller.ts:21`

## [P1] Semantic note resolution can return false negatives due top-1 global candidate then chapter/year filter

- Semantic query selects a single top embedding candidate globally.
- Chapter/year constraints are applied only after selecting that single note.
- If top match is wrong chapter/year, method returns null without checking next candidates.

Evidence:
- `src/modules/knowledgebase/services/note-resolution.service.ts:229`
- `src/modules/knowledgebase/services/note-resolution.service.ts:236`
- `src/modules/knowledgebase/services/note-resolution.service.ts:242`

## [P1] Full-schedule (`chapter='00'`) note imports are weakly usable for chapter-specific note resolution

- Upload/import defaults and recommendations push chapter `00` (full schedule).
- Extracted notes are saved with `chapter='00'`.
- Resolver infers chapter from HTS/reference and filters by chapter for exact match.
- Result: chapter-specific note lookups can miss notes extracted under `00`.

Evidence:
- `src/modules/admin/services/knowledge.admin.service.ts:100`
- `src/modules/knowledgebase/services/note-extraction.service.ts:189`
- `src/modules/knowledgebase/services/note-resolution.service.ts:145`
- `src/modules/knowledgebase/services/note-resolution.service.ts:198`
- `hts-ui/projects/admin/src/app/features/knowledge/pages/knowledge-library.page.ts:286`

## [P2] Backfill unresolved-target query ignores note year when checking note presence

- `loadTargets` unresolved detection joins `hts_notes` by `note_number + chapter` only.
- No year constraint in that join means old-year notes can suppress needed imports for current-year references.

Evidence:
- `src/modules/admin/services/knowledge.admin.service.ts:638`
- `src/modules/admin/services/knowledge.admin.service.ts:641`

## [P2] Internal `POST /knowledgebase/notes/search` uses wrong argument as HTS number

- Calls `resolveNoteReference(searchDto.chapter || '', searchDto.query)`.
- First argument should be HTS number; chapter string is not equivalent and affects chapter inference/audit quality.

Evidence:
- `src/modules/knowledgebase/controllers/knowledgebase.controller.ts:83`
- `src/modules/knowledgebase/controllers/knowledgebase.controller.ts:85`

## [P2] HTS detail page does not consume internal knowledge notes; only external chapter link

- No backend endpoint from website to fetch internal `hts_notes` by HTS/chapter.
- UI "Chapter Notes" action opens external USITC URL, not knowledge-library notes.

Evidence:
- `src/modules/lookup/controllers/lookup.controller.ts:87`
- `hts-ui/projects/website/src/app/features/hts/pages/hts-detail.page.ts:331`

## [P2] Knowledge chunk embedding job currently writes placeholder zero-vectors

- `EmbeddingGenerationJobHandler` has TODO path returning `new Array(1536).fill(0)`.
- Any chunk-semantic use relying on this job is effectively non-semantic.

Evidence:
- `src/modules/admin/jobs/embedding-generation.job-handler.ts:113`
- `src/modules/admin/jobs/embedding-generation.job-handler.ts:118`

## 6. What Works Well

- Clear modular separation: extraction (`NoteExtractionService`) vs resolution (`NoteResolutionService`) vs runtime formula retrieval (`RateRetrievalService`).
- Strong import validation gate for formula readiness, including note references.
- Audit persistence via `hts_note_references` captures resolution method/confidence/formula.
- Multiple resilience strategies in extraction: regex-first, bounded LLM fallback, deterministic fallback note.

## 7. Current State Summary: How Notes Are Actually Used Today

1. Notes are extracted and stored (`hts_notes`, `hts_note_rates`, note embeddings).  
2. Notes are used in two functional places:
   - HTS import enrichment (`hts.rateFormula`, `hts.otherRateFormula` fill-in)
   - runtime calculator fallback when textual rate references notes
3. Notes are not directly surfaced in lookup/HTS detail API responses for website users.
4. HTS detail page currently references official chapter notes externally, not internal parsed notes.

## 8. Recommended Next Implementation Steps

1. Normalize document type semantics for processing pipeline (`PDF` vs logical category) so reindex is safe for all docs.  
2. Add first-class note retrieval endpoint for website use (e.g., `/lookup/hts/:htsNumber/notes` with chapter/year context).  
3. Fix semantic resolution to query top-K and apply chapter/year filtering before final selection.  
4. Enforce year-aware unresolved-target checks in note backfill planning.  
5. Decide canonical strategy for full schedule (`00`) imports:
   - either split notes by chapter during extraction, or
   - do not recommend `00` for note-resolution workflows.
