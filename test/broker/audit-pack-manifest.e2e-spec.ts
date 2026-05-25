import { BrokerPostEntryService } from '../../src/modules/broker-post-entry/services/broker-post-entry.service';
import { createAuditMock, createRepoMock, ctx, otherCtx } from './helpers';
import type {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
} from '../../src/modules/broker-entries/entities';
import type {
  BrokerDocumentEntity,
  BrokerDocumentPacketEntity,
  BrokerExtractedFieldEntity,
} from '../../src/modules/broker-packets/entities';
import type {
  BrokerAiSuggestionEntity,
  BrokerDecisionEntity,
} from '../../src/modules/broker-decisions/entities';
import type { BrokerValidationResultEntity } from '../../src/modules/broker-rules/entities';
import type {
  BrokerExportJobEntity,
  BrokerStatusMessageEntity,
} from '../../src/modules/broker-adapters/entities';
import type {
  BrokerAuditPackEntity,
  BrokerPostEntryCaseEntity,
} from '../../src/modules/broker-post-entry/entities';

describe('BrokerPostEntryService.generateAuditPack', () => {
  function build() {
    const cases = createRepoMock<BrokerPostEntryCaseEntity>();
    const packs = createRepoMock<BrokerAuditPackEntity>();
    const entries = createRepoMock<BrokerEntryEntity>([
      {
        id: 'e1',
        brokerOrganizationId: ctx.organizationId,
        clientId: 'c1',
        entryNumber: 'E1',
        entryType: 'consumption',
        status: 'exported',
        totalValue: '100',
        totalDuty: null,
        approvedAt: new Date(),
        approvedByUserId: ctx.userId,
        exportedAt: new Date(),
        packetId: 'pk1',
      } as unknown as BrokerEntryEntity,
    ]);
    const lines = createRepoMock<BrokerEntryLineEntity>([
      {
        id: 'l1',
        entryId: 'e1',
        lineNumber: 1,
        htsNumber: '6109.10.00',
        countryOfOrigin: 'VN',
        classificationStatus: 'human_accepted',
        classificationEvidence: { suggestedHts: '6109.10.00' },
        policyFlags: null,
      } as unknown as BrokerEntryLineEntity,
    ]);
    const packets = createRepoMock<BrokerDocumentPacketEntity>([
      {
        id: 'pk1',
        brokerOrganizationId: ctx.organizationId,
        clientId: 'c1',
        status: 'extracted',
        source: 'broker',
      } as unknown as BrokerDocumentPacketEntity,
    ]);
    const documents = createRepoMock<BrokerDocumentEntity>([
      {
        id: 'd1',
        packetId: 'pk1',
        brokerOrganizationId: ctx.organizationId,
        clientId: 'c1',
        fileName: 'invoice.pdf',
        mimeType: 'application/pdf',
        documentType: 'commercial_invoice',
        sha256: 'hashx',
        scanStatus: 'clean',
      } as unknown as BrokerDocumentEntity,
    ]);
    const fields = createRepoMock<BrokerExtractedFieldEntity>([
      {
        id: 'f1',
        documentId: 'd1',
        packetId: 'pk1',
        fieldPath: 'invoice.totalValue',
        rawValue: '100',
        normalizedValue: '100',
        confidence: '0.9',
        acceptedStatus: 'accepted',
      } as unknown as BrokerExtractedFieldEntity,
    ]);
    const suggestions = createRepoMock<BrokerAiSuggestionEntity>([
      {
        id: 's1',
        brokerOrganizationId: ctx.organizationId,
        targetType: 'broker_entry_line',
        targetId: 'l1',
        suggestionType: 'hts_classification',
        value: { htsNumber: '6109.10.00' },
        modelVersion: 'v1',
        status: 'accepted',
      } as unknown as BrokerAiSuggestionEntity,
    ]);
    const decisions = createRepoMock<BrokerDecisionEntity>([
      {
        id: 'dec1',
        brokerOrganizationId: ctx.organizationId,
        suggestionId: 's1',
        targetType: 'broker_entry_line',
        targetId: 'l1',
        suggestionType: 'hts_classification',
        decision: 'accept',
        decidedByUserId: ctx.userId,
        licensedBrokerRequired: true,
        licensedBrokerSatisfied: true,
      } as unknown as BrokerDecisionEntity,
    ]);
    const results = createRepoMock<BrokerValidationResultEntity>();
    const exports = createRepoMock<BrokerExportJobEntity>([
      {
        id: 'x1',
        organizationId: ctx.organizationId,
        entryId: 'e1',
        adapterId: 'a1',
        format: 'generic_csv',
        status: 'delivered',
      } as unknown as BrokerExportJobEntity,
    ]);
    const statusMessages = createRepoMock<BrokerStatusMessageEntity>();
    const svc = new BrokerPostEntryService(
      cases as any,
      packs as any,
      entries as any,
      lines as any,
      packets as any,
      documents as any,
      fields as any,
      suggestions as any,
      decisions as any,
      results as any,
      exports as any,
      statusMessages as any,
      createAuditMock(),
    );
    return { svc, packs };
  }

  it('builds a complete decision-trail manifest with sha256 + storage key', async () => {
    const { svc, packs } = build();
    const pack = await svc.generateAuditPack(ctx, 'e1');
    expect(pack.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(pack.storageKey).toContain(ctx.organizationId);
    expect(pack.manifest).toMatchObject({
      version: 1,
      entry: expect.objectContaining({ id: 'e1', entryNumber: 'E1' }),
      lines: expect.arrayContaining([
        expect.objectContaining({ htsNumber: '6109.10.00' }),
      ]),
      documents: expect.arrayContaining([
        expect.objectContaining({ documentType: 'commercial_invoice' }),
      ]),
      brokerDecisions: expect.arrayContaining([
        expect.objectContaining({
          decision: 'accept',
          licensedBrokerSatisfied: true,
        }),
      ]),
      exports: expect.arrayContaining([
        expect.objectContaining({ status: 'delivered' }),
      ]),
    });
    expect(packs.__store).toHaveLength(1);
  });

  it('refuses to generate audit pack from another tenant', async () => {
    const { svc } = build();
    await expect(svc.generateAuditPack(otherCtx, 'e1')).rejects.toThrow(
      /another tenant/i,
    );
  });
});
