import { BrokerPacketsService } from '../../src/modules/broker-packets/services/broker-packets.service';
import { createAuditMock, createRepoMock, ctx, otherCtx } from './helpers';
import type {
  BrokerDocumentEntity,
  BrokerDocumentPacketEntity,
  BrokerExtractedFieldEntity,
} from '../../src/modules/broker-packets/entities';
import type { BrokerClientEntity } from '../../src/modules/broker-core/entities/broker-client.entity';
import type { BrokerShipmentEntity } from '../../src/modules/broker-entries/entities';

function build(
  seed: {
    clients?: Partial<BrokerClientEntity>[];
    shipments?: Partial<BrokerShipmentEntity>[];
    packets?: Partial<BrokerDocumentPacketEntity>[];
  } = {},
) {
  const packets = createRepoMock<BrokerDocumentPacketEntity>(
    (seed.packets ?? []) as BrokerDocumentPacketEntity[],
  );
  const documents = createRepoMock<BrokerDocumentEntity>();
  const fields = createRepoMock<BrokerExtractedFieldEntity>();
  const clients = createRepoMock<BrokerClientEntity>(
    (seed.clients ?? []) as BrokerClientEntity[],
  );
  const shipments = createRepoMock<BrokerShipmentEntity>(
    (seed.shipments ?? []) as BrokerShipmentEntity[],
  );
  const classifier = { classifyAsync: jest.fn() };
  const svc = new BrokerPacketsService(
    packets as any,
    documents as any,
    fields as any,
    clients as any,
    shipments as any,
    { scan: jest.fn() } as any,
    { store: jest.fn() } as any,
    classifier as any,
    { extract: jest.fn() } as any,
    { reconcile: jest.fn(() => []) } as any,
    { sendJob: jest.fn() } as any,
    { listForBusiness: jest.fn() } as any,
    { draftFromHandoff: jest.fn() } as any,
    createAuditMock(),
  );
  return { svc, packets, clients, shipments, classifier };
}

const upload = {
  fileName: 'invoice.pdf',
  mimeType: 'application/pdf',
  contentBase64: Buffer.from('invoice').toString('base64'),
};

describe('BrokerPacketsService tenant guards', () => {
  it('rejects packet creation for a client owned by another broker tenant', async () => {
    const { svc } = build({
      clients: [
        {
          id: 'client-1',
          brokerOrganizationId: otherCtx.organizationId,
          name: 'Other client',
        },
      ],
    });

    await expect(
      svc.create(ctx, {
        clientId: 'client-1',
        documents: [upload],
      } as any),
    ).rejects.toThrow(/another tenant/i);
  });

  it('rejects a shipment that belongs to a different client', async () => {
    const { svc } = build({
      clients: [
        {
          id: 'client-1',
          brokerOrganizationId: ctx.organizationId,
          name: 'Client',
        },
      ],
      shipments: [
        {
          id: 'shipment-1',
          brokerOrganizationId: ctx.organizationId,
          clientId: 'client-2',
        },
      ],
    });

    await expect(
      svc.create(ctx, {
        clientId: 'client-1',
        shipmentId: 'shipment-1',
        documents: [upload],
      } as any),
    ).rejects.toThrow(/packet client/i);
  });

  it('checks ownership before user-triggered reprocessing', async () => {
    const { svc, classifier } = build({
      packets: [
        {
          id: 'packet-1',
          brokerOrganizationId: otherCtx.organizationId,
          clientId: 'client-1',
          status: 'pending',
        },
      ],
    });

    await expect(svc.processForContext(ctx, 'packet-1')).rejects.toThrow(
      /another tenant/i,
    );
    expect(classifier.classifyAsync).not.toHaveBeenCalled();
  });
});
