/**
 * Contract spec for CalculatorV2QuoteController.
 *
 * Locks the shape of:
 *   - GET  /api/v1/calculator/v2/facts   (Phase D form-side preview)
 *   - POST /api/v1/calculator/v2/quote   (Phase A unified calculator)
 *
 * The CalculatorV2QuoteService is mocked at the dependency boundary so
 * this stays a pure shape / validation / error-mapping test.
 */

import { CalculatorV2QuoteController } from './calculator-v2-quote.controller';
import {
  EuMemberStateRequiredError,
  UnsupportedJurisdictionError,
} from '../../jurisdiction/services/jurisdiction.service';
import type { JurisdictionFacts } from '../../jurisdiction/interfaces/tariff-jurisdiction-adapter.interface';

function makeController(overrides: Partial<{
  factsFor: jest.Mock;
  quote: jest.Mock;
  resolveAdapter: jest.Mock;
}> = {}): {
  controller: CalculatorV2QuoteController;
  factsFor: jest.Mock;
  quote: jest.Mock;
} {
  const factsFor = overrides.factsFor ?? jest.fn();
  const quote = overrides.quote ?? jest.fn();
  const service: any = {
    factsFor,
    quote,
    resolveAdapter: overrides.resolveAdapter ?? jest.fn(),
  };
  const controller = new CalculatorV2QuoteController(service);
  return { controller, factsFor, quote };
}

describe('CalculatorV2QuoteController', () => {
  describe('GET /v2/facts (preview)', () => {
    const seed: JurisdictionFacts = {
      schemaName: 'Australian Border Force Working Tariff (seeded)',
      schemaEffectiveDate: '2026-05-25',
      currency: 'AUD',
      deMinimis: {
        appliesTo: 'tax_only',
        threshold: 1000,
        currency: 'AUD',
        qualified: false,
        note: 'AU LVIG/OST threshold: GST collected at point-of-sale.',
      },
      vatRules: {
        appliesAt: 'border',
        standardRate: 0.1,
        note: 'Australia GST 10% on VoTI.',
      },
      tradeAgreements: [
        { code: 'AUSFTA', label: 'US–Australia FTA', requiresCertificate: true, eligible: true },
        { code: 'CER', label: 'Closer Economic Relations (NZ)', requiresCertificate: true, eligible: false },
      ],
    };

    it('returns JurisdictionFacts for a (destination, origin) pair', async () => {
      const { controller, factsFor } = makeController();
      factsFor.mockReturnValue(seed);

      const result = await controller.previewFacts(
        'AU',
        'US',
        '1500',
        'AUD',
        { user: { organizationId: 'org_1' } } as any,
      );

      expect(result).toBe(seed);
      expect(factsFor).toHaveBeenCalledWith({
        destinationCountry: 'AU',
        destinationMemberState: undefined,
        originCountry: 'US',
        goodsValue: 1500,
        currency: 'AUD',
      });
    });

    it('accepts EU+DE shorthand for member-state routing', async () => {
      const { controller, factsFor } = makeController();
      factsFor.mockReturnValue(seed);

      await controller.previewFacts(
        'EU+DE',
        'CN',
        '500',
        'EUR',
        { user: { organizationId: 'org_1' } } as any,
      );

      expect(factsFor).toHaveBeenCalledWith({
        destinationCountry: 'EU',
        destinationMemberState: 'DE',
        originCountry: 'CN',
        goodsValue: 500,
        currency: 'EUR',
      });
    });

    it('defaults goodsValue to 0 when missing and currency to USD', async () => {
      const { controller, factsFor } = makeController();
      factsFor.mockReturnValue(seed);

      await controller.previewFacts(
        'US',
        'CN',
        undefined,
        undefined,
        { user: { organizationId: 'org_1' } } as any,
      );

      expect(factsFor).toHaveBeenCalledWith({
        destinationCountry: 'US',
        destinationMemberState: undefined,
        originCountry: 'CN',
        goodsValue: 0,
        currency: 'USD',
      });
    });

    it('rejects missing destination', async () => {
      const { controller } = makeController();
      await expect(
        controller.previewFacts(
          '',
          'CN',
          undefined,
          undefined,
          { user: { organizationId: 'org_1' } } as any,
        ),
      ).rejects.toThrow(/destination is required/);
    });

    it('rejects missing origin', async () => {
      const { controller } = makeController();
      await expect(
        controller.previewFacts(
          'US',
          '',
          undefined,
          undefined,
          { user: { organizationId: 'org_1' } } as any,
        ),
      ).rejects.toThrow(/origin is required/);
    });

    it('throws ForbiddenException when caller is unauthenticated', async () => {
      const { controller } = makeController();
      await expect(
        controller.previewFacts('AU', 'US', undefined, undefined, {} as any),
      ).rejects.toThrow(/organization is required/);
    });
  });

  describe('POST /v2/quote', () => {
    function baseRequest() {
      return {
        destination: { country: 'AU' },
        origin: { country: 'CN' },
        currency: 'AUD',
        items: [
          { classificationCode: '6109.10.00.04', quantity: 1, unitValue: 1000 },
        ],
      };
    }

    it('returns the service result on success', async () => {
      const { controller, quote } = makeController();
      const stubResult = { quoteId: 'quote_x', engineVersion: 'hts-native-v2-quote' };
      quote.mockResolvedValue(stubResult);
      const out = await controller.quoteJwt(
        baseRequest() as any,
        { user: { organizationId: 'org_1' } } as any,
      );
      expect(out).toBe(stubResult);
    });

    it('rejects empty items', async () => {
      const { controller } = makeController();
      await expect(
        controller.quoteJwt(
          { ...baseRequest(), items: [] } as any,
          { user: { organizationId: 'org_1' } } as any,
        ),
      ).rejects.toThrow(/items must contain at least one line/);
    });

    it('rejects a line with missing classification code', async () => {
      const { controller } = makeController();
      await expect(
        controller.quoteJwt(
          {
            ...baseRequest(),
            items: [{ quantity: 1, unitValue: 1000 }],
          } as any,
          { user: { organizationId: 'org_1' } } as any,
        ),
      ).rejects.toThrow(/classificationCode is required/);
    });

    it('rejects a line with quantity <= 0', async () => {
      const { controller } = makeController();
      await expect(
        controller.quoteJwt(
          {
            ...baseRequest(),
            items: [
              { classificationCode: '6109.10.00.04', quantity: 0, unitValue: 1000 },
            ],
          } as any,
          { user: { organizationId: 'org_1' } } as any,
        ),
      ).rejects.toThrow(/quantity must be > 0/);
    });

    it('maps EuMemberStateRequiredError to HTTP 400 with structured body', async () => {
      const { controller, quote } = makeController();
      quote.mockRejectedValue(new EuMemberStateRequiredError());
      const promise = controller.quoteJwt(
        baseRequest() as any,
        { user: { organizationId: 'org_1' } } as any,
      );
      await expect(promise).rejects.toMatchObject({
        status: 400,
        response: { code: 'EU_REQUIRES_MEMBER_STATE' },
      });
    });

    it('maps UnsupportedJurisdictionError to HTTP 400 with structured body', async () => {
      const { controller, quote } = makeController();
      quote.mockRejectedValue(new UnsupportedJurisdictionError('JP'));
      const promise = controller.quoteJwt(
        baseRequest() as any,
        { user: { organizationId: 'org_1' } } as any,
      );
      await expect(promise).rejects.toMatchObject({
        status: 400,
        response: { code: 'UNSUPPORTED_JURISDICTION' },
      });
    });

    it('throws ForbiddenException when caller is unauthenticated on JWT route', async () => {
      const { controller } = makeController();
      await expect(
        controller.quoteJwt(baseRequest() as any, {} as any),
      ).rejects.toThrow(/organization is required/);
    });

    it('API-key route does not require user context (guard handles auth)', async () => {
      const { controller, quote } = makeController();
      const stubResult = { quoteId: 'quote_x' };
      quote.mockResolvedValue(stubResult);
      const out = await controller.quoteApiKey(
        baseRequest() as any,
        { organizationId: 'org_apikey' } as any,
      );
      expect(out).toBe(stubResult);
    });

    // E1 fix (2026-05-26): JWT route MUST NOT fall back to req.organizationId.
    it('E1: JWT route refuses an org set only on req.organizationId (no req.user)', async () => {
      const { controller, quote } = makeController();
      quote.mockResolvedValue({ quoteId: 'quote_x' });
      // Simulate a misordered middleware that set the API-key slot
      // but no JWT. The JWT route must NOT honor that org.
      await expect(
        controller.quoteJwt(
          baseRequest() as any,
          { organizationId: 'org_apikey_should_be_ignored' } as any,
        ),
      ).rejects.toThrow(/organization is required/);
      expect(quote).not.toHaveBeenCalled();
    });

    it('E1: JWT route uses req.user.organizationId even when req.organizationId is also set', async () => {
      const { controller, quote } = makeController();
      quote.mockResolvedValue({ quoteId: 'quote_x' });
      await controller.quoteJwt(
        baseRequest() as any,
        {
          user: { organizationId: 'org_from_jwt', id: 'user_1' },
          organizationId: 'org_from_apikey_should_be_ignored',
        } as any,
      );
      const [, caller] = quote.mock.calls[0];
      expect(caller).toEqual({ organizationId: 'org_from_jwt', userId: 'user_1' });
    });

    // E2 fix (2026-05-26): API-key route requires the key to resolve to an org.
    it('E2: API-key route refuses a request where the key did not resolve to an org', async () => {
      const { controller, quote } = makeController();
      quote.mockResolvedValue({ quoteId: 'quote_x' });
      await expect(
        controller.quoteApiKey(baseRequest() as any, {} as any),
      ).rejects.toThrow(/API key did not resolve to an organization/);
      expect(quote).not.toHaveBeenCalled();
    });
  });

  // E3 fix (2026-05-26): previewFacts must also be JWT-only.
  describe('previewFacts auth (E3)', () => {
    it('refuses when only req.organizationId is set (no req.user)', async () => {
      const { controller, factsFor } = makeController();
      await expect(
        controller.previewFacts(
          'AU',
          'US',
          undefined,
          undefined,
          { organizationId: 'org_apikey_should_be_ignored' } as any,
        ),
      ).rejects.toThrow(/organization is required/);
      expect(factsFor).not.toHaveBeenCalled();
    });

    it('API-key facts route requires the key to resolve to an org', async () => {
      const { controller, factsFor } = makeController();
      factsFor.mockReturnValue({} as any);
      await expect(
        controller.previewFactsApiKey('AU', 'US', undefined, undefined, {} as any),
      ).rejects.toThrow(/API key did not resolve to an organization/);
      expect(factsFor).not.toHaveBeenCalled();
    });

    it('API-key facts route succeeds when the key carries an org', async () => {
      const { controller, factsFor } = makeController();
      const seed = { schemaName: 'x' } as any;
      factsFor.mockReturnValue(seed);
      const out = await controller.previewFactsApiKey(
        'AU',
        'US',
        undefined,
        undefined,
        { organizationId: 'org_apikey' } as any,
      );
      expect(out).toBe(seed);
    });
  });
});
