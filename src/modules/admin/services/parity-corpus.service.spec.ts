import { ParityCorpusService } from './parity-corpus.service';

describe('ParityCorpusService.classifyRateText', () => {
  const svc = new ParityCorpusService({} as any);

  it('returns ch99 for any 99-prefixed HTS regardless of rate text', () => {
    expect(svc.classifyRateText('5%', '9903.88.15')).toBe('ch99');
    expect(svc.classifyRateText(null, '9903.88.03')).toBe('ch99');
  });

  it('returns free for "Free" or "0%"', () => {
    expect(svc.classifyRateText('Free', '6109100040')).toBe('free');
    expect(svc.classifyRateText('0%', '6109100040')).toBe('free');
    expect(svc.classifyRateText('0', '6109100040')).toBe('free');
  });

  it('returns pct for plain percentage rate', () => {
    expect(svc.classifyRateText('5%', '6109100040')).toBe('pct');
    expect(svc.classifyRateText('16.5%', '6109100040')).toBe('pct');
  });

  it('returns specific for $/kg, ¢/doz, /pair', () => {
    expect(svc.classifyRateText('$2.50/kg', '0101.21.00')).toBe('specific');
    expect(svc.classifyRateText('25¢/doz', '0101.21.00')).toBe('specific');
    expect(svc.classifyRateText('15 cents per pair', '6403.99.00')).toBe('specific');
  });

  it('returns compound for percent + specific', () => {
    expect(svc.classifyRateText('5% + $2.50/kg', '6109100040')).toBe('compound');
    expect(svc.classifyRateText('12% plus 32.5¢/kg', '0101.21.00')).toBe('compound');
  });

  it('returns unknown for empty or unparseable text', () => {
    expect(svc.classifyRateText('', '6109100040')).toBe('unknown');
    expect(svc.classifyRateText(null, '6109100040')).toBe('unknown');
    expect(svc.classifyRateText('see note 1(a)', '6109100040')).toBe('unknown');
  });
});
