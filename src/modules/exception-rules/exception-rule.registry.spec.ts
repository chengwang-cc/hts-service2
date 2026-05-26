import { ExceptionRuleRegistry } from './exception-rule.registry';
import type { ExceptionRule, ExceptionRuleContext } from './types';

function mkRule(overrides: Partial<ExceptionRule> = {}): ExceptionRule {
  return {
    id: 'test.rule',
    destination: 'US',
    authority: 'section_232',
    title: 'Test',
    priority: 1000,
    knowledgeCardKeys: [],
    isApplicable: (_: ExceptionRuleContext) => false,
    evaluate: () => ({}),
    declaredInputs: () => [],
    ...overrides,
  };
}

describe('ExceptionRuleRegistry', () => {
  let registry: ExceptionRuleRegistry;

  beforeEach(() => {
    registry = new ExceptionRuleRegistry();
  });

  it('returns empty when nothing registered', () => {
    expect(registry.all()).toEqual([]);
    expect(registry.rulesFor('US')).toEqual([]);
    expect(registry.size()).toBe(0);
  });

  it('registers and exposes a rule', () => {
    const r = mkRule({ id: 'a' });
    registry.register(r);
    expect(registry.size()).toBe(1);
    expect(registry.all()).toEqual([r]);
    expect(registry.get('a')).toBe(r);
  });

  it('rejects duplicate ids loudly', () => {
    registry.register(mkRule({ id: 'a' }));
    expect(() => registry.register(mkRule({ id: 'a' }))).toThrow(
      /duplicate rule id "a"/,
    );
  });

  it('sorts inserts by priority (lower first)', () => {
    registry.register(mkRule({ id: 'high', priority: 5000 }));
    registry.register(mkRule({ id: 'low', priority: 1000 }));
    registry.register(mkRule({ id: 'mid', priority: 3000 }));
    expect(registry.all().map((r) => r.id)).toEqual(['low', 'mid', 'high']);
  });

  it('preserves insertion order for equal-priority rules', () => {
    registry.register(mkRule({ id: 'first', priority: 1000 }));
    registry.register(mkRule({ id: 'second', priority: 1000 }));
    registry.register(mkRule({ id: 'third', priority: 1000 }));
    expect(registry.all().map((r) => r.id)).toEqual(['first', 'second', 'third']);
  });

  it('filters by destination, case-insensitive', () => {
    registry.register(mkRule({ id: 'us-a', destination: 'US' }));
    registry.register(mkRule({ id: 'ca-a', destination: 'CA' }));
    registry.register(mkRule({ id: 'us-b', destination: 'us' }));
    expect(registry.rulesFor('us').map((r) => r.id)).toEqual(['us-a', 'us-b']);
    expect(registry.rulesFor('CA').map((r) => r.id)).toEqual(['ca-a']);
    expect(registry.rulesFor('XX')).toEqual([]);
  });

  it('builds reverse index from knowledgeCardKeys', () => {
    const r1 = mkRule({ id: 'r1', knowledgeCardKeys: ['cbp.csms.1', 'cbp.csms.2'] });
    const r2 = mkRule({ id: 'r2', knowledgeCardKeys: ['cbp.csms.2', 'fr.proc.10895'] });
    registry.register(r1);
    registry.register(r2);
    expect(registry.rulesForCard('cbp.csms.1').map((r) => r.id)).toEqual(['r1']);
    expect(registry.rulesForCard('cbp.csms.2').map((r) => r.id).sort()).toEqual(
      ['r1', 'r2'],
    );
    expect(registry.rulesForCard('fr.proc.10895').map((r) => r.id)).toEqual(['r2']);
    expect(registry.rulesForCard('unknown')).toEqual([]);
  });

  it('invalidates reverse index after a new registration', () => {
    registry.register(mkRule({ id: 'r1', knowledgeCardKeys: ['k1'] }));
    expect(registry.rulesForCard('k1').map((r) => r.id)).toEqual(['r1']);
    registry.register(mkRule({ id: 'r2', knowledgeCardKeys: ['k1'] }));
    expect(registry.rulesForCard('k1').map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });
});
