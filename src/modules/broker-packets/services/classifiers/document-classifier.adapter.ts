import { BrokerDocumentEntity } from '../../entities';

export interface DocumentClassificationResult {
  documentType: BrokerDocumentEntity['documentType'];
  confidence: number;
}

export abstract class DocumentClassifierAdapter {
  abstract readonly providerKey: string;
  abstract classify(
    fileName: string,
    mimeType: string,
  ): Promise<DocumentClassificationResult>;
}

export const DOCUMENT_CLASSIFIER_ADAPTER =
  'DOCUMENT_CLASSIFIER_ADAPTER' as const;
