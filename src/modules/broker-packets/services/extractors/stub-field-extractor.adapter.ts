import { Injectable } from '@nestjs/common';
import {
  ExtractedFieldSeed,
  ExtractionContext,
  FieldExtractorAdapter,
} from './field-extractor.adapter';

/**
 * Heuristic extractor — seeds placeholder fields per document type with
 * confidence 0 so the workbench has something to render. This is the
 * fallback when no real OCR/LLM provider is configured.
 */
@Injectable()
export class StubFieldExtractorAdapter extends FieldExtractorAdapter {
  readonly providerKey = 'stub';

  async extract(ctx: ExtractionContext): Promise<ExtractedFieldSeed[]> {
    const baseModel = 'stub-extractor-v1';
    const { document } = ctx;
    switch (document.documentType) {
      case 'commercial_invoice':
        return [
          seed('invoice.number', baseModel),
          seed('invoice.date', baseModel),
          seed('invoice.totalValue', baseModel),
          {
            fieldPath: 'invoice.currency',
            rawValue: 'USD',
            normalizedValue: 'USD',
            confidence: 0.6,
            page: 1,
            sourceModel: baseModel,
          },
          seed('invoice.seller.name', baseModel),
          seed('invoice.buyer.name', baseModel),
          seed('invoice.line[0].description', baseModel),
          seed('invoice.line[0].quantity', baseModel),
          seed('invoice.line[0].unitValue', baseModel),
        ];
      case 'packing_list':
        return [
          seed('packingList.totalPackages', baseModel),
          seed('packingList.grossWeight', baseModel),
          seed('packingList.netWeight', baseModel),
        ];
      case 'bol':
      case 'awb':
        return [
          seed('shipment.carrier', baseModel),
          seed('shipment.vesselOrFlight', baseModel),
          seed('shipment.portOfLading', baseModel),
          seed('shipment.portOfUnlading', baseModel),
        ];
      case 'origin_certificate':
        return [
          seed('origin.country', baseModel),
          seed('origin.preferenceProgram', baseModel),
        ];
      case 'arrival_notice':
        return [seed('arrival.eta', baseModel), seed('arrival.portOfUnlading', baseModel)];
      case 'isf':
        return [seed('isf.manufacturer', baseModel), seed('isf.shipToParty', baseModel)];
      default:
        return [seed('document.summary', baseModel)];
    }
  }
}

function seed(fieldPath: string, sourceModel: string): ExtractedFieldSeed {
  return {
    fieldPath,
    rawValue: '',
    confidence: 0.0,
    page: 1,
    sourceModel,
  };
}
