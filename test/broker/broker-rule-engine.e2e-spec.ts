import { BrokerRuleEngine } from '../../src/modules/broker-rules/services/broker-rule-engine.service';
import type { BrokerEntryEntity } from '../../src/modules/broker-entries/entities/broker-entry.entity';
import type { BrokerEntryLineEntity } from '../../src/modules/broker-entries/entities/broker-entry-line.entity';
import type { BrokerRuleEntity } from '../../src/modules/broker-rules/entities/broker-rule.entity';
import type { BrokerClientRelationshipEntity } from '../../src/modules/broker-core/entities/broker-client-relationship.entity';

const engine = new BrokerRuleEngine();

function entry(overrides: Partial<BrokerEntryEntity> = {}): BrokerEntryEntity {
  return {
    id: 'entry-1',
    brokerOrganizationId: 'org-broker',
    clientId: 'client-1',
    shipmentId: null,
    packetId: null,
    entryNumber: 'E0001',
    entryType: 'consumption',
    status: 'draft',
    riskLevel: 'medium',
    assigneeUserId: 'user-1',
    dueAt: null,
    approvedAt: null,
    approvedByUserId: null,
    exportedAt: null,
    currency: 'USD',
    totalValue: '0',
    totalDuty: null,
    blockers: [],
    metadata: null,
    internalNotes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as BrokerEntryEntity;
}

function line(overrides: Partial<BrokerEntryLineEntity> = {}): BrokerEntryLineEntity {
  return {
    id: 'line-1',
    entryId: 'entry-1',
    lineNumber: 1,
    sku: 'SKU1',
    description: 'desc',
    htsNumber: '6109.10.00',
    countryOfOrigin: 'VN',
    quantity: '10',
    unitOfMeasure: 'EA',
    unitValue: '100',
    currency: 'USD',
    totalValue: '1000',
    estimatedDuty: null,
    classificationStatus: 'human_accepted',
    classificationEvidence: null,
    validationIssues: null,
    policyFlags: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as BrokerEntryLineEntity;
}

describe('BrokerRuleEngine', () => {
  it('produces blockers for missing HTS, missing COO, and missing UoM', () => {
    const issues = engine.evaluate({
      entry: entry(),
      lines: [
        line({
          id: 'l1',
          htsNumber: null,
          countryOfOrigin: null,
          unitOfMeasure: null,
        }),
      ],
      rules: [],
    });
    const codes = issues.map((i) => i.ruleCode);
    expect(codes).toContain('LINE_HTS_REQUIRED');
    expect(codes).toContain('LINE_COUNTRY_OF_ORIGIN_REQUIRED');
    expect(codes).toContain('LINE_UOM_RECOMMENDED');
  });

  it('warns when total deviates >1% from quantity*unitValue', () => {
    const issues = engine.evaluate({
      entry: entry(),
      // 10 * 100 = 1000, total reported 800 → 20% off → warning
      lines: [line({ totalValue: '800', quantity: '10', unitValue: '100' })],
      rules: [],
    });
    expect(issues.some((i) => i.ruleCode === 'LINE_VALUE_MATH')).toBe(true);
  });

  it('does not warn when totals match exactly', () => {
    const issues = engine.evaluate({
      entry: entry(),
      lines: [line({ totalValue: '1000', quantity: '10', unitValue: '100' })],
      rules: [],
    });
    expect(issues.some((i) => i.ruleCode === 'LINE_VALUE_MATH')).toBe(false);
  });

  it('warns on HTS format that is not dotted', () => {
    const issues = engine.evaluate({
      entry: entry(),
      lines: [line({ htsNumber: '610910' })],
      rules: [],
    });
    expect(issues.some((i) => i.ruleCode === 'LINE_HTS_FORMAT')).toBe(true);
  });

  it('blocks approval when entry has no lines', () => {
    const issues = engine.evaluate({ entry: entry(), lines: [], rules: [] });
    expect(issues.some((i) => i.ruleCode === 'ENTRY_LINES_REQUIRED' && i.severity === 'blocker')).toBe(
      true,
    );
  });

  it('requires an entry number before approval', () => {
    const issues = engine.evaluate({
      entry: entry({ entryNumber: null, status: 'ready_to_file' }),
      lines: [line()],
      rules: [],
    });
    expect(
      issues.some(
        (i) => i.ruleCode === 'ENTRY_NUMBER_REQUIRED_BEFORE_FILE' && i.severity === 'blocker',
      ),
    ).toBe(true);
  });

  it('blocks when POA is missing or expired', () => {
    const rel = {
      poaStatus: 'missing',
    } as unknown as BrokerClientRelationshipEntity;
    const issues = engine.evaluate({
      entry: entry(),
      lines: [line()],
      rules: [],
      relationship: rel,
    });
    expect(issues.some((i) => i.ruleCode === 'POA_REQUIRED' && i.severity === 'blocker')).toBe(
      true,
    );
  });

  it('flags Section 301 review for CN-origin lines without a 301 policy flag', () => {
    const issues = engine.evaluate({
      entry: entry(),
      lines: [line({ countryOfOrigin: 'CN', policyFlags: null })],
      rules: [],
    });
    expect(issues.some((i) => i.ruleCode === 'POLICY_SECTION_301_CHECK')).toBe(true);
  });

  it('does not flag Section 301 if line already has a SECTION_301 policy flag', () => {
    const issues = engine.evaluate({
      entry: entry(),
      lines: [
        line({
          countryOfOrigin: 'CN',
          policyFlags: [{ program: 'SECTION_301' }],
        }),
      ],
      rules: [],
    });
    expect(issues.some((i) => i.ruleCode === 'POLICY_SECTION_301_CHECK')).toBe(false);
  });

  it('blocks export when required docs are missing', () => {
    const issues = engine.evaluate({
      entry: entry(),
      lines: [line()],
      rules: [],
      documentTypesAvailable: ['commercial_invoice'], // packing_list missing
    });
    expect(
      issues.some(
        (i) => i.ruleCode === 'DOC_REQUIRED_PACKING_LIST' && i.severity === 'blocker',
      ),
    ).toBe(true);
  });

  it('honors org-scoped value_threshold rule', () => {
    const rule = {
      id: 'r1',
      code: 'org.high_value',
      title: 'High-value review',
      scope: 'organization',
      severity: 'warning',
      ruleType: 'value_threshold',
      config: { threshold: 50 },
      enabled: true,
    } as unknown as BrokerRuleEntity;
    const issues = engine.evaluate({
      entry: entry({ totalValue: '100' }),
      lines: [line()],
      rules: [rule],
    });
    expect(issues.some((i) => i.ruleCode === 'org.high_value')).toBe(true);
  });

  it('skips disabled rules', () => {
    const rule = {
      id: 'r1',
      code: 'org.high_value',
      title: 'High-value review',
      scope: 'organization',
      severity: 'warning',
      ruleType: 'value_threshold',
      config: { threshold: 50 },
      enabled: false,
    } as unknown as BrokerRuleEntity;
    const issues = engine.evaluate({
      entry: entry({ totalValue: '100' }),
      lines: [line()],
      rules: [rule],
    });
    expect(issues.some((i) => i.ruleCode === 'org.high_value')).toBe(false);
  });

  it('toEntryBlockers omits info-only issues', () => {
    const blockers = BrokerRuleEngine.toEntryBlockers([
      { ruleCode: 'A', severity: 'info', message: 'note' },
      { ruleCode: 'B', severity: 'warning', message: 'warn' },
      { ruleCode: 'C', severity: 'blocker', message: 'block' },
    ]);
    expect(blockers).toHaveLength(2);
    expect(blockers.find((b) => b.code === 'A')).toBeUndefined();
  });
});
