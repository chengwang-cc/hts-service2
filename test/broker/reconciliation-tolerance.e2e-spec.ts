import { PacketReconciliationService } from '../../src/modules/broker-packets/services/reconciliation.service';
import type { BrokerExtractedFieldEntity } from '../../src/modules/broker-packets/entities/broker-extracted-field.entity';

const rec = new PacketReconciliationService();

function field(
  fieldPath: string,
  rawValue: string,
  documentId = 'd' + Math.random(),
): BrokerExtractedFieldEntity {
  return {
    id: 'f' + Math.random(),
    documentId,
    packetId: 'p1',
    fieldPath,
    rawValue,
    normalizedValue: null,
    reviewedValue: null,
    acceptedStatus: 'suggested',
    confidence: '1.0',
    page: 1,
    sourceModel: 'test',
    reviewedByUserId: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as BrokerExtractedFieldEntity;
}

describe('R1-E-03: per-client reconciliation tolerance', () => {
  it('treats numeric values within tolerance as equivalent (no finding)', () => {
    const findings = rec.reconcile(
      [
        field('invoice.totalValue', '1000.00', 'd-invoice'),
        field('invoice.totalValue', '1005.00', 'd-bol'),
      ],
      { tolerancePct: 1 },
    );
    expect(findings).toEqual([]);
  });

  it('flags numeric drift outside the tolerance', () => {
    const findings = rec.reconcile(
      [
        field('invoice.totalValue', '1000.00', 'd-invoice'),
        field('invoice.totalValue', '1050.00', 'd-bol'),
      ],
      { tolerancePct: 1 },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('blocker');
    expect(findings[0].notes).toMatch(/tolerance ±1%/);
  });

  it('still flags categorical mismatches regardless of tolerance', () => {
    const findings = rec.reconcile(
      [
        field('origin.country', 'CN', 'd1'),
        field('origin.country', 'VN', 'd2'),
      ],
      { tolerancePct: 10 },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toBe('countryOfOrigin');
  });

  it('treats a 0% tolerance as strict equality', () => {
    const findings = rec.reconcile(
      [
        field('invoice.totalValue', '1000', 'd1'),
        field('invoice.totalValue', '1000.01', 'd2'),
      ],
      { tolerancePct: 0 },
    );
    expect(findings).toHaveLength(1);
  });
});
