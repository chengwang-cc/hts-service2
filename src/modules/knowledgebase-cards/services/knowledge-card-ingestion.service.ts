import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { EmbeddingService } from '@hts/core';
import { DocumentExtractorService } from './document-extractor.service';
import { DocumentChunkerService } from './document-chunker.service';
import { DocumentClassifierService } from './document-classifier.service';
import { KnowledgeCardService } from './knowledge-card.service';
import { KnowledgeCrawlerPolicyService } from './knowledge-crawler-policy.service';
import type { CardUpsertResult } from './knowledge-card.service';

/**
 * KnowledgeCardIngestionService (Phase 8, T3–T7).
 *
 * Orchestrates: fetch (URL) or accept (buffer) → extract → chunk →
 * classify → upsert card → embed (best-effort).
 *
 * Returns the upsert outcome ("inserted" / "unchanged" / "superseded")
 * so callers can react (e.g. open alerts on superseded).
 */
export interface IngestUrlInput {
  url: string;
  hint?: {
    documentType?: string;
    suggestedCardKey?: string;
    jurisdiction?: string;
  };
  ingestedBy?: string;
}

export interface IngestBufferInput {
  buffer: Buffer;
  contentType: string;
  originalFilename?: string | null;
  hint?: {
    documentType?: string;
    suggestedCardKey?: string;
    jurisdiction?: string;
  };
  storageRef?: string | null;
  ingestedBy?: string;
}

export interface IngestResult {
  upsert: CardUpsertResult;
  cardKey: string;
  classification: {
    documentType: string;
    jurisdiction: string | null;
    confidence: number;
    matchedHeuristic: string | null;
  };
  chunkCount: number;
  embeddingStatus: 'generated' | 'skipped' | 'failed';
}

@Injectable()
export class KnowledgeCardIngestionService {
  private readonly logger = new Logger(KnowledgeCardIngestionService.name);

  constructor(
    private readonly extractor: DocumentExtractorService,
    private readonly chunker: DocumentChunkerService,
    private readonly classifier: DocumentClassifierService,
    private readonly cards: KnowledgeCardService,
    private readonly embeddings: EmbeddingService,
    @Optional()
    private readonly crawlerPolicy: KnowledgeCrawlerPolicyService | null = null,
  ) {}

  /**
   * Fetch the URL and ingest. Routed through the crawler outbound
   * policy when present (SSRF guards, response size cap, redirect
   * limit, content-type allowlist). Falls back to a plain fetch only
   * when the policy is unbound (e.g. unit tests injecting a custom
   * fetch).
   */
  async ingestUrl(input: IngestUrlInput): Promise<IngestResult> {
    if (this.crawlerPolicy) {
      const fetched = await this.crawlerPolicy.fetch(input.url);
      return this.ingestBuffer({
        buffer: fetched.buffer,
        contentType: fetched.contentType,
        storageRef: fetched.finalUrl,
        hint: { ...input.hint, jurisdiction: input.hint?.jurisdiction },
        ingestedBy: input.ingestedBy ?? `url:${input.url}`,
      });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(input.url, { signal: controller.signal });
      if (!res.ok) {
        throw new BadRequestException(
          `fetch ${input.url} returned HTTP ${res.status}`,
        );
      }
      const ab = await res.arrayBuffer();
      const buffer = Buffer.from(ab);
      const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
      return await this.ingestBuffer({
        buffer,
        contentType,
        storageRef: input.url,
        hint: { ...input.hint, jurisdiction: input.hint?.jurisdiction },
        ingestedBy: input.ingestedBy ?? `url:${input.url}`,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async ingestBuffer(input: IngestBufferInput): Promise<IngestResult> {
    // 1. Extract
    const extracted = await this.extractor.extract({
      buffer: input.buffer,
      contentType: input.contentType,
      sourceUrl: input.storageRef ?? null,
    });
    if (extracted.text.length < 32) {
      throw new BadRequestException(
        `extraction produced ${extracted.text.length} chars; likely a parse failure`,
      );
    }

    // 2. Chunk
    const chunks = this.chunker.chunk({
      text: extracted.text,
      headings: extracted.headings,
    });

    // 3. Classify
    const classification = this.classifier.classify({
      text: extracted.text,
      url: input.storageRef ?? null,
      hint: input.hint,
    });

    // 4. Upsert card
    const payload: Record<string, unknown> = {
      text: extracted.text,
      headings: extracted.headings,
      chunks: chunks.map((c) => ({
        ordinal: c.ordinal,
        headingPath: c.headingPath,
        charStart: c.charStart,
        charEnd: c.charEnd,
        // Don't duplicate body in payload — chunks reference offsets.
      })),
      classifier: classification,
      sourceContentType: input.contentType,
      ingestedAt: new Date().toISOString(),
    };
    const upsert = await this.cards.upsert({
      cardKey: classification.suggestedCardKey,
      documentType: classification.documentType,
      jurisdiction: classification.jurisdiction,
      sourceUrl: input.storageRef ?? null,
      storageRef: input.storageRef ?? null,
      text: extracted.text,
      payload,
      effectiveDate: classification.effectiveDate ?? null,
      ingestedBy: input.ingestedBy ?? 'system',
    });

    // 5. Embed the head of the document (best-effort).
    let embeddingStatus: 'generated' | 'skipped' | 'failed' = 'skipped';
    if (upsert.outcome !== 'unchanged') {
      try {
        const head = extracted.text.slice(0, 8000);
        const vector = await this.embeddings.generateEmbedding(head);
        const { column } = this.embeddings.providerInfo;
        await this.cards.writeEmbedding(upsert.card.id, vector, column);
        embeddingStatus = 'generated';
      } catch (e: any) {
        this.logger.warn(`embed.failed cardKey=${classification.suggestedCardKey}: ${e?.message ?? e}`);
        embeddingStatus = 'failed';
      }
    }

    this.logger.log(
      `ingest.${upsert.outcome} cardKey=${classification.suggestedCardKey} chunks=${chunks.length} heuristic=${classification.matchedHeuristic ?? 'fallback'}`,
    );

    return {
      upsert,
      cardKey: classification.suggestedCardKey,
      classification: {
        documentType: classification.documentType,
        jurisdiction: classification.jurisdiction,
        confidence: classification.confidence,
        matchedHeuristic: classification.matchedHeuristic,
      },
      chunkCount: chunks.length,
      embeddingStatus,
    };
  }
}
