import { Injectable, Logger, Optional } from '@nestjs/common';
import { EmbeddingService } from '../../../../core/services/embedding.service';
import {
  DocumentClassificationResult,
  DocumentClassifierAdapter,
} from './document-classifier.adapter';

/**
 * Embedding-based classifier. Embeds the filename + extension and compares
 * cosine similarity against a small library of prototype phrases per
 * document type, picking the best match. Designed to win on confusable
 * names like `commercial-invoice.pdf` vs `bol-invoice.pdf` where the pure
 * substring heuristic flips on word order.
 *
 * Falls back to a neutral 'unknown' result when EmbeddingService is not
 * available or fails; callers should always chain through the heuristic
 * adapter as a final fallback (the service wires this).
 */
@Injectable()
export class EmbeddingClassifierAdapter extends DocumentClassifierAdapter {
  readonly providerKey = 'embedding';
  private readonly logger = new Logger(EmbeddingClassifierAdapter.name);
  private prototypeCache: Array<{
    documentType: string;
    vector: number[];
  }> | null = null;
  private prototypePromise: Promise<void> | null = null;

  constructor(
    @Optional() private readonly embeddings: EmbeddingService | null,
  ) {
    super();
    if (!embeddings) {
      this.logger.warn(
        'EmbeddingClassifierAdapter constructed without EmbeddingService — classify() will return unknown',
      );
    }
  }

  async classify(
    fileName: string,
    mimeType: string,
  ): Promise<DocumentClassificationResult> {
    if (!this.embeddings) {
      return { documentType: 'unknown', confidence: 0.0 };
    }
    try {
      await this.ensurePrototypes();
      if (!this.prototypeCache?.length) {
        return { documentType: 'unknown', confidence: 0.0 };
      }
      const queryText = buildQueryText(fileName, mimeType);
      const queryVec = await this.embeddings.generateEmbedding(queryText);
      let best: { documentType: string; score: number } | null = null;
      let runnerUp: { documentType: string; score: number } | null = null;
      for (const proto of this.prototypeCache) {
        const score = cosine(queryVec, proto.vector);
        if (!best || score > best.score) {
          runnerUp = best;
          best = { documentType: proto.documentType, score };
        } else if (!runnerUp || score > runnerUp.score) {
          runnerUp = { documentType: proto.documentType, score };
        }
      }
      if (!best) return { documentType: 'unknown', confidence: 0.0 };
      // Map cosine similarity (-1..1) into a usable 0..1 confidence, then
      // shrink by the gap to runner-up so close calls land lower.
      const cosine01 = (best.score + 1) / 2;
      const margin = runnerUp ? best.score - runnerUp.score : 0;
      const confidence = clamp01(cosine01 * 0.7 + Math.max(0, margin) * 0.6);
      return {
        documentType:
          best.documentType as DocumentClassificationResult['documentType'],
        confidence,
      };
    } catch (err) {
      this.logger.warn(
        `Embedding classifier failed: ${(err as Error).message}`,
      );
      return { documentType: 'unknown', confidence: 0.0 };
    }
  }

  private async ensurePrototypes(): Promise<void> {
    if (this.prototypeCache !== null) return;
    if (this.prototypePromise) return this.prototypePromise;
    this.prototypePromise = (async () => {
      if (!this.embeddings) return;
      const built: Array<{ documentType: string; vector: number[] }> = [];
      for (const [documentType, phrases] of Object.entries(PROTOTYPES)) {
        for (const phrase of phrases) {
          try {
            const vec = await this.embeddings.generateEmbedding(phrase);
            built.push({ documentType, vector: vec });
          } catch (err) {
            this.logger.warn(
              `Failed to embed prototype "${phrase}": ${(err as Error).message}`,
            );
          }
        }
      }
      this.prototypeCache = built;
      this.logger.log(
        `Loaded ${built.length} document-type prototype embeddings`,
      );
    })();
    return this.prototypePromise;
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function buildQueryText(fileName: string, mimeType: string): string {
  const base = fileName.replace(/[._-]+/g, ' ').replace(/\.[a-z0-9]+$/i, '');
  return `Customs broker document. Filename: ${base}. Mime: ${mimeType}`;
}

const PROTOTYPES: Record<string, string[]> = {
  commercial_invoice: [
    'commercial invoice from seller to buyer with line items, unit values, currency',
    'sales invoice for goods being imported',
  ],
  packing_list: [
    'packing list with carton counts, gross and net weights, dimensions',
    'shipping packing list itemising packages and weights',
  ],
  bol: [
    'bill of lading ocean freight carrier vessel voyage',
    'ocean bill of lading B/L number consignee shipper',
  ],
  awb: [
    'air waybill flight number airline air freight tracking',
    'AWB master house air waybill',
  ],
  origin_certificate: [
    'certificate of origin signed by chamber of commerce stating country of manufacture',
    'free trade agreement certificate of origin USMCA CAFTA',
  ],
  arrival_notice: [
    'arrival notice from carrier with vessel ETA and discharge port',
    'cargo arrival notification port of unlading',
  ],
  isf: [
    'importer security filing ISF 10+2 manufacturer ship to party',
    'importer security filing transmission',
  ],
  poa: [
    'power of attorney customs broker authorisation to file entries',
    'POA broker power of attorney signed by importer of record',
  ],
};
