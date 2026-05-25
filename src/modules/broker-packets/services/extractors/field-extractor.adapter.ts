import { BrokerDocumentEntity } from '../../entities';

export interface ExtractedFieldSeed {
  fieldPath: string;
  rawValue: string;
  normalizedValue?: string;
  confidence: number;
  page?: number;
  /**
   * R1-E-01 — bounding box in the rendered PDF page, normalised to [0..1].
   * Production OCR/LLM adapters populate this; the heuristic stub omits it.
   */
  coordinates?: {
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  sourceModel: string;
}

export interface ExtractionContext {
  document: BrokerDocumentEntity;
  /**
   * Raw bytes — populated when the storage layer is available (production
   * via S3 fetch + signed URL, dev via local-disk read). When absent the
   * adapter falls back to filename / documentType heuristics only.
   */
  content?: Buffer;
}

export abstract class FieldExtractorAdapter {
  abstract readonly providerKey: string;
  abstract extract(ctx: ExtractionContext): Promise<ExtractedFieldSeed[]>;
}

export const FIELD_EXTRACTOR_ADAPTER = 'FIELD_EXTRACTOR_ADAPTER' as const;
export const FIELD_REASONER_ADAPTER = 'FIELD_REASONER_ADAPTER' as const;
