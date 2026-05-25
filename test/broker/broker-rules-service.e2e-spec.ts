import { BrokerRuleEngine } from '../../src/modules/broker-rules/services/broker-rule-engine.service';
import { BrokerRulesService } from '../../src/modules/broker-rules/services/broker-rules.service';
import { createAuditMock, createRepoMock, ctx, otherCtx } from './helpers';
import type {
  BrokerRuleEntity,
  BrokerValidationResultEntity,
} from '../../src/modules/broker-rules/entities';
import type { BrokerEntryEntity } from '../../src/modules/broker-entries/entities/broker-entry.entity';
import type { BrokerEntryLineEntity } from '../../src/modules/broker-entries/entities/broker-entry-line.entity';
import type { BrokerClientRelationshipEntity } from '../../src/modules/broker-core/entities/broker-client-relationship.entity';
import type { BrokerDocumentEntity } from '../../src/modules/broker-packets/entities/broker-document.entity';

function build(seed: {
  rules?: Partial<BrokerRuleEntity>[];
  entries?: Partial<BrokerEntryEntity>[];
  lines?: Partial<BrokerEntryLineEntity>[];
  relationships?: Partial<BrokerClientRelationshipEntity>[];
  documents?: Partial<BrokerDocumentEntity>[];
}) {
  const rules = createRepoMock<BrokerRuleEntity>(
    seed.rules as unknown as BrokerRuleEntity[] ?? [],
  );
  const results = createRepoMock<BrokerValidationResultEntity>();
  const entries = createRepoMock<BrokerEntryEntity>(
    seed.entries as unknown as BrokerEntryEntity[] ?? [],
  );
  const lines = createRepoMock<BrokerEntryLineEntity>(
    seed.lines as unknown as BrokerEntryLineEntity[] ?? [],
  );
  const relationships = createRepoMock<BrokerClientRelationshipEntity>(
    seed.relationships as unknown as BrokerClientRelationshipEntity[] ?? [],
  );
  const documents = createRepoMock<BrokerDocumentEntity>(
    seed.documents as unknown as BrokerDocumentEntity[] ?? [],
  );
  const svc = new BrokerRulesService(
    rules as any,
    results as any,
    entries as any,
    lines as any,
    relationships as any,
    documents as any,
    new BrokerRuleEngine(),
    createAuditMock(),
  );
  return { svc, rules, results, entries, lines, relationships, documents };
}

describe('BrokerRulesService.validateEntry — client-scoped rule filter', () => {
  it('client-scoped rule fires only on entries for that client', async () => {
    const wrongClientRule = {
      id: 'r1',
      code: 'client.must.have.entryNumber',
      scope: 'client' as const,
      organizationId: ctx.organizationId,
      clientId: 'client-X',
      severity: 'blocker' as const,
      ruleType: 'required_field' as const,
      config: { field: 'entry.entryNumber' },
      enabled: true,
      title: 'Require entry number',
    };
    const { svc } = build({
      rules: [wrongClientRule],
      entries: [
        {
          id: 'e1',
          brokerOrganizationId: ctx.organizationId,
          clientId: 'client-Y',
          entryNumber: null,
        },
      ],
      lines: [{ id: 'l1', entryId: 'e1', lineNumber: 1, htsNumber: '6109.10.00', countryOfOrigin: 'VN', unitOfMeasure: 'EA' }],
    });
    const { issues } = await svc.validateEntry(ctx, 'e1');
    expect(issues.some((i) => i.ruleCode === 'client.must.have.entryNumber')).toBe(
      false,
    );
  });

  it('client-scoped rule fires when entry.clientId matches rule.clientId', async () => {
    const matchingRule = {
      id: 'r1',
      code: 'client.must.have.entryNumber',
      scope: 'client' as const,
      organizationId: ctx.organizationId,
      clientId: 'client-X',
      severity: 'blocker' as const,
      ruleType: 'required_field' as const,
      config: { field: 'entry.entryNumber' },
      enabled: true,
      title: 'Require entry number',
    };
    const { svc } = build({
      rules: [matchingRule],
      entries: [
        {
          id: 'e1',
          brokerOrganizationId: ctx.organizationId,
          clientId: 'client-X',
          entryNumber: null,
        },
      ],
      lines: [{ id: 'l1', entryId: 'e1', lineNumber: 1, htsNumber: '6109.10.00', countryOfOrigin: 'VN', unitOfMeasure: 'EA' }],
    });
    const { issues } = await svc.validateEntry(ctx, 'e1');
    expect(issues.some((i) => i.ruleCode === 'client.must.have.entryNumber')).toBe(true);
  });

  it('refuses validate on entry from another tenant', async () => {
    const { svc } = build({
      entries: [
        { id: 'e1', brokerOrganizationId: ctx.organizationId, clientId: 'c' },
      ],
    });
    await expect(svc.validateEntry(otherCtx, 'e1')).rejects.toThrow(
      /another tenant/i,
    );
  });

  it('syncs entry.blockers after validation (drops info, keeps warning + blocker)', async () => {
    const { svc, entries } = build({
      entries: [
        {
          id: 'e1',
          brokerOrganizationId: ctx.organizationId,
          clientId: 'c',
          entryNumber: 'E1',
        },
      ],
      lines: [
        // missing COO → blocker, missing UoM → warning
        { id: 'l1', entryId: 'e1', lineNumber: 1, htsNumber: '6109.10.00' },
      ],
    });
    await svc.validateEntry(ctx, 'e1');
    const blockers = entries.__store[0].blockers ?? [];
    expect(blockers.some((b) => b.severity === 'blocker')).toBe(true);
    expect(blockers.some((b) => b.code === 'LINE_HTS_FORMAT' || b.severity === 'warning')).toBe(
      true,
    );
  });
});
