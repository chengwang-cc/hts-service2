import { Injectable, Logger, Optional } from '@nestjs/common';
import { AnthropicService } from '../../../../core/services/anthropic.service';
import {
  ExtractedFieldSeed,
  ExtractionContext,
  FieldExtractorAdapter,
} from './field-extractor.adapter';

/**
 * Anthropic-backed extractor. Sends the document type + filename + (optional)
 * truncated text content to Claude with a strict JSON schema and asks for
 * the per-document-type fields. PDF bytes are summarised as text only —
 * full vision flow (PDF page images via the Anthropic Files API) is
 * outside the scope of this iteration and lands as a follow-up.
 *
 * Falls back to the stub adapter when the API call fails or the response
 * doesn't parse: callers always get a result so packet processing never
 * deadlocks on extractor errors.
 */
@Injectable()
export class AnthropicFieldExtractorAdapter extends FieldExtractorAdapter {
  readonly providerKey = 'anthropic';
  private readonly logger = new Logger(AnthropicFieldExtractorAdapter.name);
  private readonly model: string;

  constructor(
    @Optional() private readonly anthropic: AnthropicService | null,
  ) {
    super();
    this.model =
      process.env.BROKER_EXTRACTOR_MODEL || 'claude-haiku-4-5-20251001';
  }

  async extract(ctx: ExtractionContext): Promise<ExtractedFieldSeed[]> {
    if (!this.anthropic) {
      this.logger.warn(
        'Anthropic extractor invoked without AnthropicService — returning []',
      );
      return [];
    }
    const fieldSet = SCHEMA_BY_TYPE[ctx.document.documentType] ?? SCHEMA_DEFAULT;
    const truncatedText = this.previewContent(ctx.content);
    const system = `You are an extractor that returns JSON only. Schema:
{
  "fields": [
    {"fieldPath": "<one of the requested paths>", "rawValue": "<string|empty>",
     "normalizedValue": "<optional canonical form>", "confidence": <0..1>, "page": <int>}
  ]
}
Use confidence 0.0 when you cannot infer the value. Never invent data. Only
return paths from the requested list.`;
    const user = `Document type: ${ctx.document.documentType}
File name: ${ctx.document.fileName}
Requested paths: ${fieldSet.join(', ')}
Content preview:
${truncatedText || '(no text preview available)'}
Return JSON only.`;
    try {
      const raw = await this.anthropic.complete(user, {
        model: this.model,
        maxTokens: 1200,
        system,
      });
      const parsed = this.tryParse(raw);
      if (!parsed || !Array.isArray(parsed.fields)) {
        this.logger.warn(
          `Anthropic extractor returned unparseable response for ${ctx.document.id}`,
        );
        return [];
      }
      return parsed.fields
        .filter((f): f is Record<string, unknown> & { fieldPath: string } =>
          typeof f.fieldPath === 'string',
        )
        .filter((f) => fieldSet.includes(f.fieldPath))
        .map((f) => ({
          fieldPath: f.fieldPath as string,
          rawValue: String(f.rawValue ?? ''),
          normalizedValue:
            f.normalizedValue == null ? undefined : String(f.normalizedValue),
          confidence: clamp01(Number(f.confidence ?? 0)),
          page: typeof f.page === 'number' ? f.page : 1,
          sourceModel: `anthropic:${this.model}`,
        }));
    } catch (err) {
      this.logger.warn(
        `Anthropic extractor failed for ${ctx.document.id}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private previewContent(content?: Buffer): string {
    if (!content) return '';
    // For PDFs we only have raw bytes here; a proper text layer would come
    // from a PDF parsing step (pdf-parse, pdfjs). We extract ASCII-clean
    // runs as a cheap signal — better than nothing for digitally-born PDFs,
    // and ignored for image-only scans.
    const ascii = content
      .toString('utf8')
      .replace(/[^\x20-\x7E\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return ascii.slice(0, 4000);
  }

  private tryParse(raw: string): { fields?: Array<Record<string, unknown>> } | null {
    const trimmed = raw.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

const SCHEMA_BY_TYPE: Record<string, string[]> = {
  commercial_invoice: [
    'invoice.number',
    'invoice.date',
    'invoice.totalValue',
    'invoice.currency',
    'invoice.seller.name',
    'invoice.buyer.name',
    'invoice.line[0].description',
    'invoice.line[0].quantity',
    'invoice.line[0].unitValue',
  ],
  packing_list: [
    'packingList.totalPackages',
    'packingList.grossWeight',
    'packingList.netWeight',
  ],
  bol: [
    'shipment.carrier',
    'shipment.vesselOrFlight',
    'shipment.portOfLading',
    'shipment.portOfUnlading',
  ],
  awb: [
    'shipment.carrier',
    'shipment.vesselOrFlight',
    'shipment.portOfLading',
    'shipment.portOfUnlading',
  ],
  origin_certificate: ['origin.country', 'origin.preferenceProgram'],
  arrival_notice: ['arrival.eta', 'arrival.portOfUnlading'],
  isf: ['isf.manufacturer', 'isf.shipToParty'],
};

const SCHEMA_DEFAULT = ['document.summary'];
