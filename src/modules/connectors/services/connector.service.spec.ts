import { stripRedactedSecrets } from './connector.service';

describe('stripRedactedSecrets', () => {
  it('removes accessToken/apiSecret/apiKey when set to literal "***"', () => {
    const stripped = stripRedactedSecrets({
      shopUrl: 'shop.example',
      accessToken: '***',
      apiSecret: '***',
      apiKey: '***',
      extra: 'kept',
    });
    expect(stripped).toEqual({ shopUrl: 'shop.example', extra: 'kept' });
  });

  it('keeps real secret values untouched', () => {
    const stripped = stripRedactedSecrets({
      shopUrl: 'shop.example',
      accessToken: 'shpat_real',
      apiSecret: 'sk_real',
      apiKey: 'pk_real',
    });
    expect(stripped).toEqual({
      shopUrl: 'shop.example',
      accessToken: 'shpat_real',
      apiSecret: 'sk_real',
      apiKey: 'pk_real',
    });
  });

  it('returns undefined for undefined input', () => {
    expect(stripRedactedSecrets(undefined)).toBeUndefined();
  });
});
