import { BrokerDecisionsService } from '../../src/modules/broker-decisions/services/broker-decisions.service';
import { createRepoMock, createAuditMock, ctx, otherCtx } from './helpers';
import type {
  BrokerAiSuggestionEntity,
  BrokerDecisionEntity,
} from '../../src/modules/broker-decisions/entities';
import type { BrokerEntryEntity } from '../../src/modules/broker-entries/entities/broker-entry.entity';
import type { BrokerEntryLineEntity } from '../../src/modules/broker-entries/entities/broker-entry-line.entity';

function build(seed: {
  suggestions?: Partial<BrokerAiSuggestionEntity>[];
  entries?: Partial<BrokerEntryEntity>[];
  lines?: Partial<BrokerEntryLineEntity>[];
} = {}) {
  const suggestions = createRepoMock<BrokerAiSuggestionEntity>(
    seed.suggestions as unknown as BrokerAiSuggestionEntity[] ?? [],
  );
  const decisions = createRepoMock<BrokerDecisionEntity>();
  const lines = createRepoMock<BrokerEntryLineEntity>(
    seed.lines as unknown as BrokerEntryLineEntity[] ?? [],
  );
  const entries = createRepoMock<BrokerEntryEntity>(
    seed.entries as unknown as BrokerEntryEntity[] ?? [],
  );
  const search = { hybridSearch: jest.fn(async () => []) } as any;
  const audit = createAuditMock();
  const svc = new BrokerDecisionsService(
    suggestions as any,
    decisions as any,
    lines as any,
    entries as any,
    search,
    audit,
  );
  return { svc, suggestions, decisions, lines, entries, search, audit };
}

describe('BrokerDecisionsService — licensed broker policy', () => {
  it('refuses to accept an HTS suggestion without licensed broker satisfaction', async () => {
    const { svc } = build({
      suggestions: [
        {
          id: 's1',
          brokerOrganizationId: ctx.organizationId,
          targetType: 'broker_entry_line',
          targetId: 'line-1',
          suggestionType: 'hts_classification',
          status: 'pending',
          value: { htsNumber: '6109.10' },
        },
      ],
    });
    await expect(
      svc.decideSuggestion(ctx, 's1', { decision: 'accept' }),
    ).rejects.toThrow(/licensed broker approver/i);
  });

  it('records decision when licensedBrokerSatisfied is true', async () => {
    const { svc, decisions, suggestions } = build({
      suggestions: [
        {
          id: 's1',
          brokerOrganizationId: ctx.organizationId,
          targetType: 'broker_entry_line',
          targetId: 'line-1',
          suggestionType: 'hts_classification',
          status: 'pending',
          value: { htsNumber: '6109.10' },
        },
      ],
      entries: [
        {
          id: 'entry-1',
          brokerOrganizationId: ctx.organizationId,
        },
      ],
      lines: [
        {
          id: 'line-1',
          entryId: 'entry-1',
          lineNumber: 1,
          classificationStatus: 'ai_suggested',
        },
      ],
    });
    const out = await svc.decideSuggestion(ctx, 's1', {
      decision: 'accept',
      licensedBrokerSatisfied: true,
    });
    expect(out.decision.licensedBrokerSatisfied).toBe(true);
    expect(decisions.__store).toHaveLength(1);
    expect(suggestions.__store[0].status).toBe('accepted');
  });

  it('allows reject without licensed broker', async () => {
    const { svc } = build({
      suggestions: [
        {
          id: 's1',
          brokerOrganizationId: ctx.organizationId,
          targetType: 'broker_entry_line',
          targetId: 'line-1',
          suggestionType: 'hts_classification',
          status: 'pending',
          value: { htsNumber: '6109.10' },
        },
      ],
    });
    const out = await svc.decideSuggestion(ctx, 's1', { decision: 'reject' });
    expect(out.suggestion.status).toBe('rejected');
  });

  it('refuses cross-tenant access to a suggestion', async () => {
    const { svc } = build({
      suggestions: [
        {
          id: 's1',
          brokerOrganizationId: ctx.organizationId,
          targetType: 'broker_entry_line',
          targetId: 'line-1',
          suggestionType: 'hts_classification',
          status: 'pending',
          value: {},
        },
      ],
    });
    await expect(
      svc.decideSuggestion(otherCtx, 's1', { decision: 'reject' }),
    ).rejects.toThrow(/another tenant/i);
  });

  it('overridden suggestion records human_overridden classification status', async () => {
    const { svc, lines } = build({
      suggestions: [
        {
          id: 's1',
          brokerOrganizationId: ctx.organizationId,
          targetType: 'broker_entry_line',
          targetId: 'line-1',
          suggestionType: 'hts_classification',
          status: 'pending',
          value: { htsNumber: '6109.10' },
        },
      ],
      entries: [
        { id: 'entry-1', brokerOrganizationId: ctx.organizationId },
      ],
      lines: [
        {
          id: 'line-1',
          entryId: 'entry-1',
          lineNumber: 1,
          classificationStatus: 'ai_suggested',
        },
      ],
    });
    await svc.decideSuggestion(ctx, 's1', {
      decision: 'override',
      finalValue: { htsNumber: '6110.20' },
      licensedBrokerSatisfied: true,
    });
    expect(lines.__store[0].classificationStatus).toBe('human_overridden');
    expect(lines.__store[0].htsNumber).toBe('6110.20');
  });
});

describe('BrokerDecisionsService — bulk decisions', () => {
  it('rejects bulk approval when shared rationale is too short', async () => {
    const { svc } = build({
      suggestions: [
        {
          id: 's1',
          brokerOrganizationId: ctx.organizationId,
          targetType: 'broker_entry_line',
          targetId: 'l1',
          suggestionType: 'document_field_fix',
          status: 'pending',
          value: {},
        },
      ],
    });
    await expect(
      svc.bulkDecide(ctx, {
        decision: 'accept',
        sharedRationale: 'too short',
        items: [{ suggestionId: 's1' }],
      }),
    ).rejects.toThrow(/at least 20 characters/i);
  });

  it('requires licensedBrokerSatisfied=true when bulk accepting customs-business suggestions', async () => {
    const { svc } = build({
      suggestions: [
        {
          id: 's1',
          brokerOrganizationId: ctx.organizationId,
          targetType: 'broker_entry_line',
          targetId: 'l1',
          suggestionType: 'hts_classification',
          status: 'pending',
          value: { htsNumber: '6109.10' },
        },
      ],
    });
    await expect(
      svc.bulkDecide(ctx, {
        decision: 'accept',
        sharedRationale:
          'These are all the same SKU and the AI got it right on every line.',
        items: [{ suggestionId: 's1' }],
      }),
    ).rejects.toThrow(/licensedBrokerSatisfied=true/);
  });

  it('records bulkActionId + sharedRationale on every decision row', async () => {
    const { svc, decisions } = build({
      suggestions: [
        {
          id: 's1',
          brokerOrganizationId: ctx.organizationId,
          targetType: 'broker_entry_line',
          targetId: 'l1',
          suggestionType: 'document_field_fix',
          status: 'pending',
          value: {},
        },
        {
          id: 's2',
          brokerOrganizationId: ctx.organizationId,
          targetType: 'broker_entry_line',
          targetId: 'l2',
          suggestionType: 'document_field_fix',
          status: 'pending',
          value: {},
        },
      ],
      entries: [{ id: 'e1', brokerOrganizationId: ctx.organizationId }],
      lines: [
        { id: 'l1', entryId: 'e1', lineNumber: 1 },
        { id: 'l2', entryId: 'e1', lineNumber: 2 },
      ],
    });
    const out = await svc.bulkDecide(ctx, {
      decision: 'accept',
      sharedRationale:
        'All extractions matched the invoice; safe to accept document fixes.',
      items: [{ suggestionId: 's1' }, { suggestionId: 's2' }],
    });
    expect(out.count).toBe(2);
    expect(decisions.__store).toHaveLength(2);
    expect(decisions.__store[0].bulkContext?.bulkActionId).toBe(out.bulkActionId);
  });
});
