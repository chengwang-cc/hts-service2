import { HeuristicClassifierAdapter } from '../../src/modules/broker-packets/services/classifiers/heuristic-classifier.adapter';
import { DocumentClassifierService } from '../../src/modules/broker-packets/services/document-classifier.service';
import { StubFieldExtractorAdapter } from '../../src/modules/broker-packets/services/extractors/stub-field-extractor.adapter';
import { FieldExtractorService } from '../../src/modules/broker-packets/services/field-extractor.service';
import { PacketReconciliationService } from '../../src/modules/broker-packets/services/reconciliation.service';
import type { BrokerDocumentEntity } from '../../src/modules/broker-packets/entities/broker-document.entity';
import type { BrokerExtractedFieldEntity } from '../../src/modules/broker-packets/entities/broker-extracted-field.entity';

const heuristic = new HeuristicClassifierAdapter();
const stub = new StubFieldExtractorAdapter();
const cls = new DocumentClassifierService(null, heuristic);
const ext = new FieldExtractorService(null, null, stub);
const rec = new PacketReconciliationService();

describe('DocumentClassifierService', () => {
  it('detects commercial invoice from filename', () => {
    const r = cls.classify('invoice_2026_01.pdf', 'application/pdf');
    expect(r.documentType).toBe('commercial_invoice');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('detects packing list', () => {
    expect(cls.classify('packing_list.pdf', 'application/pdf').documentType).toBe(
      'packing_list',
    );
  });

  it('detects BOL and AWB', () => {
    expect(cls.classify('master_bol.pdf', 'application/pdf').documentType).toBe('bol');
    expect(cls.classify('awb_123.pdf', 'application/pdf').documentType).toBe('awb');
  });

  it('falls back to "unknown" for non-pdf with no keyword', () => {
    expect(
      cls.classify('random_thing.txt', 'text/plain').documentType,
    ).toBe('unknown');
  });
});

describe('FieldExtractorService', () => {
  it('seeds invoice line skeleton with provenance fields', async () => {
    const seeds = await ext.extract({
      document: { documentType: 'commercial_invoice' } as BrokerDocumentEntity,
    });
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.every((s) => s.fieldPath.startsWith('invoice.'))).toBe(true);
    expect(seeds.every((s) => s.sourceModel)).toBe(true);
  });

  it('returns at least a generic document.summary for unknown types', async () => {
    const seeds = await ext.extract({
      document: { documentType: 'unknown' } as BrokerDocumentEntity,
    });
    expect(seeds.some((s) => s.fieldPath === 'document.summary')).toBe(true);
  });
});

describe('PacketReconciliationService', () => {
  function field(
    overrides: Partial<BrokerExtractedFieldEntity>,
  ): BrokerExtractedFieldEntity {
    return {
      id: 'f' + Math.random(),
      documentId: 'd1',
      packetId: 'p1',
      fieldPath: 'invoice.totalValue',
      rawValue: null,
      normalizedValue: null,
      confidence: '0.9',
      acceptedStatus: 'suggested',
      reviewedValue: null,
      ...overrides,
    } as unknown as BrokerExtractedFieldEntity;
  }

  it('flags blocker-severity conflicts for totalValue', () => {
    const findings = rec.reconcile([
      field({
        id: 'a',
        documentId: 'd1',
        fieldPath: 'invoice.totalValue',
        normalizedValue: '100',
      }),
      field({
        id: 'b',
        documentId: 'd2',
        fieldPath: 'invoice.totalValue',
        normalizedValue: '200',
      }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('blocker');
    expect(findings[0].sourceDocumentIds).toContain('d1');
    expect(findings[0].sourceDocumentIds).toContain('d2');
  });

  it('treats override value as the canonical reading', () => {
    const findings = rec.reconcile([
      field({
        id: 'a',
        documentId: 'd1',
        fieldPath: 'invoice.totalValue',
        normalizedValue: '100',
        reviewedValue: '200',
        acceptedStatus: 'overridden',
      }),
      field({
        id: 'b',
        documentId: 'd2',
        fieldPath: 'invoice.totalValue',
        normalizedValue: '200',
      }),
    ]);
    // After override both readings are 200 → no conflict
    expect(findings).toHaveLength(0);
  });

  it('returns nothing when values agree across docs', () => {
    const findings = rec.reconcile([
      field({ id: 'a', documentId: 'd1', normalizedValue: '50' }),
      field({ id: 'b', documentId: 'd2', normalizedValue: '50' }),
    ]);
    expect(findings).toHaveLength(0);
  });
});
