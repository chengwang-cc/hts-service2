# Knowledge Library Note Flow for HTS Lookup and HTS Calculation

Date: 2026-02-22
Scope: `hts-service` + `hts-ui` (website HTS detail)

## 1. Purpose

This document explains, end-to-end, how HTS notes are:

1. Ingested from HTS PDF documents.
2. Converted into structured note data and formulas.
3. Used for HTS lookup and HTS duty calculation.
4. Exposed in the HTS detail page in `hts-ui`.

## 2. Data Objects Involved

Core tables/entities:

1. `hts_documents` (`HtsDocumentEntity`): source chapter/full-schedule documents, parsed text, processing status.
2. `hts_notes` (`HtsNoteEntity`): extracted notes (`noteType`, `noteNumber`, `chapter`, `year`, `content`).
3. `hts_note_rates` (`HtsNoteRateEntity`): extracted rate text + resolved formula/variables per note.
4. `hts_note_embeddings` (`HtsNoteEmbeddingEntity`): semantic vectors for note matching.
5. `hts_note_references` (`HtsNoteReferenceEntity`): audit records of rate-text-to-note resolution.
6. `knowledge_chunks` (`KnowledgeChunkEntity`): chunked document text for broader knowledge retrieval.

## 3. Ingestion and Note Extraction Pipeline

### 3.1 Admin ingestion

Entry points are in `KnowledgeAdminService` and `KnowledgeAdminController`.

1. Admin uploads or imports HTS document.
2. Document row is created in `hts_documents`.
3. Queue job `document-processing` runs.

Primary files:

- `src/modules/admin/services/knowledge.admin.service.ts`
- `src/modules/admin/jobs/document-processing.job-handler.ts`

### 3.2 Processing stages

`DocumentProcessingJobHandler` stages:

1. `DOWNLOADING`
2. `DOWNLOADED`
3. `PARSING`
4. `PARSED`
5. `EXTRACTING_NOTES`
6. `CHUNKING`
7. `COMPLETED`

Important correction implemented:

- Documents with type `CHAPTER` and `GENERAL` are now treated as PDF payloads during S3 upload/parsing, same as `PDF`.
- This prevents reindex/parse failures where chapter docs were previously treated as text files.

### 3.3 Note extraction

`NoteExtractionService.extractNotes`:

1. Splits parsed text into note sections (general/additional/chapter/statistical/section where possible).
2. Extracts notes using regex-first strategy.
3. Falls back to LLM extraction when regex is insufficient.
4. Persists deduplicated notes to `hts_notes`.
5. Extracts note rate formulas and stores in `hts_note_rates`.
6. Generates embeddings in `hts_note_embeddings`.

Primary file:

- `src/modules/knowledgebase/services/note-extraction.service.ts`

## 4. How Notes Are Resolved for HTS Rate Text

`NoteResolutionService.resolveNoteReference(htsNumber, referenceText, sourceColumn, year, options)` resolves references like "See note 2".

Resolution order:

1. Parse note number and context (chapter, note type).
2. Exact match in `hts_notes`.
3. Semantic match in `hts_note_embeddings` if exact fails.

### 4.1 Matching improvements implemented

1. Semantic match now checks top-K candidates instead of only one global top result.
2. Chapter/year filtering is applied in the semantic query itself.
3. Chapter fallback supports `chapter='00'` notes when chapter-specific note is missing.
4. Exact match also supports chapter fallback to `00`.

Primary file:

- `src/modules/knowledgebase/services/note-resolution.service.ts`

## 5. How Notes Are Used in HTS Calculation

### 5.1 Import-time enrichment

During HTS import, if `general` or `other` rate text references notes and no formula exists:

1. Import job calls `resolveNoteReference`.
2. If resolved and note has formula in `hts_note_rates`, formula is copied into HTS fields:
   - `hts.rateFormula` (general)
   - `hts.otherRateFormula` (other)

Primary file:

- `src/modules/admin/jobs/hts-import.job-handler.ts`

### 5.2 Runtime calculation fallback

`RateRetrievalService.getRate` evaluation path includes note resolution fallback:

1. Try direct formulas on the HTS row.
2. If still unresolved and rate text contains note reference, call `resolveNoteReference`.
3. Use resolved formula from note for duty calculation.

Primary file:

- `src/modules/calculator/services/rate-retrieval.service.ts`

Final duty computation is done in:

- `src/modules/calculator/services/calculation.service.ts`

## 6. How Notes Are Used in HTS Lookup

### 6.1 HTS detail lookup endpoint

- `GET /lookup/hts/:htsNumber`
- Returns HTS row details (including stored formulas if import already enriched them).

Primary file:

- `src/modules/lookup/controllers/lookup.controller.ts`

### 6.2 New internal note lookup endpoint

- `GET /lookup/hts/:htsNumber/notes[?year=YYYY]`

Behavior:

1. Load HTS entry.
2. Check `general` and `other` text for note references.
3. Resolve each reference using `NoteResolutionService` in read-only mode (`persistResolution: false`).
4. Return resolved internal notes with formula/confidence/metadata.

Returned payload includes:

1. `htsNumber`, `chapter`, `year`, `count`
2. `notes[]` entries with:
   - `sourceColumn`
   - `referenceText`
   - `noteNumber`
   - `noteContent`
   - `formula`
   - `confidence`
   - `metadata` (note id/type/chapter/year)

Primary file:

- `src/modules/lookup/controllers/lookup.controller.ts`

## 7. How Notes Are Displayed in HTS UI Detail Page

Website HTS detail flow now uses both endpoints:

1. `GET /lookup/hts/:htsNumber`
2. `GET /lookup/hts/:htsNumber/notes`

UI behavior in `HtsDetailPage`:

1. Load HTS detail.
2. Fetch internal resolved notes for that HTS.
3. Render a "Knowledge Library Notes" section showing:
   - source column (`general` or `other`)
   - note number
   - confidence
   - referenced rate text
   - internal note content
   - resolved formula (if available)
4. Keep external "Official Chapter Notes" button for direct USITC reference.

Primary files:

- `hts-ui/projects/website/src/app/services/hts-search.service.ts`
- `hts-ui/projects/website/src/app/features/hts/pages/hts-detail.page.ts`

## 8. Public Knowledgebase Query/Recommend Behavior

The public knowledgebase API now includes knowledge-library artifacts in addition to HTS search results:

1. `POST /api/v1/knowledgebase/query`
2. `POST /api/v1/knowledgebase/recommend`

Both now return:

1. HTS search results/recommendations.
2. Matching internal notes (`noteMatches`).
3. Matching document chunks (`chunkMatches`).

Primary file:

- `src/modules/public-api/v1/controllers/knowledgebase-public.controller.ts`

## 9. Backfill Planning and Year Accuracy

Backfill target selection now checks note presence with year-aware matching and chapter fallback (`targetChapter` or `00`), preventing false "already resolved" signals from prior years.

Primary file:

- `src/modules/admin/services/knowledge.admin.service.ts`

## 10. Embedding Generation Status

Chunk embeddings now use real OpenAI embeddings (`text-embedding-3-small`) instead of placeholder zero vectors.

Primary file:

- `src/modules/admin/jobs/embedding-generation.job-handler.ts`

