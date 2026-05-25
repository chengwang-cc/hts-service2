import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { BrokerDocumentEntity } from '../entities';
import {
  DocumentClassificationResult,
  DocumentClassifierAdapter,
  DOCUMENT_CLASSIFIER_ADAPTER,
} from './classifiers/document-classifier.adapter';
import { HeuristicClassifierAdapter } from './classifiers/heuristic-classifier.adapter';

export type { DocumentClassificationResult } from './classifiers/document-classifier.adapter';

/**
 * Routes classification through the configured primary adapter and falls
 * back to the filename heuristic when the primary returns low confidence
 * (or fails entirely). The fallback floor is governed by
 * BROKER_CLASSIFIER_FALLBACK_THRESHOLD (default 0.5).
 *
 * The legacy synchronous `classify()` signature is preserved by running
 * only the heuristic adapter; callers that want the embedding classifier
 * should use `classifyAsync()`.
 */
@Injectable()
export class DocumentClassifierService {
  private readonly logger = new Logger(DocumentClassifierService.name);
  private readonly fallbackThreshold: number;

  constructor(
    @Optional()
    @Inject(DOCUMENT_CLASSIFIER_ADAPTER)
    private readonly primary: DocumentClassifierAdapter | null,
    private readonly heuristic: HeuristicClassifierAdapter,
  ) {
    this.fallbackThreshold = clamp01(
      Number(process.env.BROKER_CLASSIFIER_FALLBACK_THRESHOLD || 0.5),
    );
    this.logger.log(
      `Document classifier: primary=${primary?.providerKey ?? heuristic.providerKey} fallback=${heuristic.providerKey} threshold=${this.fallbackThreshold}`,
    );
  }

  /**
   * Synchronous classifier — heuristic only. Kept for backward compatibility
   * with any caller that hasn't migrated to async. New code uses
   * `classifyAsync()` which also runs the configured primary adapter.
   */
  classify(
    fileName: string,
    mimeType: string,
  ): DocumentClassificationResult {
    return synchronousHeuristic(fileName, mimeType);
  }

  async classifyAsync(
    fileName: string,
    mimeType: string,
  ): Promise<DocumentClassificationResult> {
    const primary = this.primary;
    if (primary) {
      try {
        const result = await primary.classify(fileName, mimeType);
        if (
          result.documentType !== 'unknown' &&
          result.confidence >= this.fallbackThreshold
        ) {
          return result;
        }
      } catch (err) {
        this.logger.warn(
          `Primary classifier ${primary.providerKey} failed: ${(err as Error).message}`,
        );
      }
    }
    return this.heuristic.classify(fileName, mimeType);
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// Mirror of HeuristicClassifierAdapter without the async wrapping, so the
// legacy `classify()` signature can stay synchronous.
function synchronousHeuristic(
  fileName: string,
  mimeType: string,
): DocumentClassificationResult {
  const name = fileName.toLowerCase();
  if (name.includes('invoice') || name.includes('ci_')) {
    return { documentType: 'commercial_invoice', confidence: 0.85 };
  }
  if (name.includes('packing') || name.includes('pl_')) {
    return { documentType: 'packing_list', confidence: 0.85 };
  }
  if (name.includes('bol') || name.includes('bill of lading')) {
    return { documentType: 'bol', confidence: 0.85 };
  }
  if (name.includes('awb') || name.includes('air waybill')) {
    return { documentType: 'awb', confidence: 0.85 };
  }
  if (name.includes('arrival') || name.includes('arrival_notice')) {
    return { documentType: 'arrival_notice', confidence: 0.75 };
  }
  if (name.includes('certificate') || name.includes('coo')) {
    return { documentType: 'origin_certificate', confidence: 0.75 };
  }
  if (name.includes('isf')) {
    return { documentType: 'isf', confidence: 0.85 };
  }
  if (name.includes('poa') || name.includes('power of attorney')) {
    return { documentType: 'poa', confidence: 0.85 };
  }
  if (mimeType === 'application/pdf') {
    return { documentType: 'other', confidence: 0.5 };
  }
  return { documentType: 'unknown', confidence: 0.3 };
}
