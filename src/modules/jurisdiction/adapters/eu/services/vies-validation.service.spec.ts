import { ViesValidationService } from './vies-validation.service';

describe('ViesValidationService', () => {
  const svc = new ViesValidationService();

  it('accepts well-formed DE VAT id (9 digits)', () => {
    const r = svc.validate('DE123456789');
    expect(r.valid).toBe(true);
    expect(r.countryCode).toBe('DE');
    expect(r.warnings).toContain('VIES_LIVE_VALIDATION_NOT_PERFORMED');
  });

  it('rejects DE id with wrong digit count', () => {
    const r = svc.validate('DE1234');
    expect(r.valid).toBe(false);
    expect(r.warnings).toContain('VAT_FORMAT_INVALID');
  });

  it('accepts well-formed NL VAT id (9 digits + B + 2 digits)', () => {
    const r = svc.validate('NL123456789B01');
    expect(r.valid).toBe(true);
  });

  it('accepts well-formed FR VAT id', () => {
    const r = svc.validate('FRAB123456789');
    expect(r.valid).toBe(true);
  });

  it('rejects unknown country prefix', () => {
    const r = svc.validate('ZZ123456789');
    expect(r.valid).toBe(false);
    expect(r.warnings).toContain('UNKNOWN_VAT_COUNTRY_CODE');
  });

  it('lowercases / trims input safely', () => {
    const r = svc.validate('  de123456789  ');
    expect(r.valid).toBe(true);
    expect(r.countryCode).toBe('DE');
  });
});
