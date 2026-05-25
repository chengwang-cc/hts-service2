import { Injectable } from '@nestjs/common';
import {
  DocumentClassificationResult,
  DocumentClassifierAdapter,
} from './document-classifier.adapter';

@Injectable()
export class HeuristicClassifierAdapter extends DocumentClassifierAdapter {
  readonly providerKey = 'heuristic';

  async classify(
    fileName: string,
    mimeType: string,
  ): Promise<DocumentClassificationResult> {
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
}
