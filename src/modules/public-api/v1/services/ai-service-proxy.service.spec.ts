import { HttpException } from '@nestjs/common';
import { AiServiceProxyService } from './ai-service-proxy.service';

class StubConfig {
  private store: Record<string, string>;
  constructor(store: Record<string, string> = {}) {
    this.store = store;
  }
  get<T = string>(key: string): T | undefined {
    return this.store[key] as any;
  }
}

describe('AiServiceProxyService', () => {
  describe('upstream URL + headers resolution', () => {
    it('prefers AI_SERVICE_URL when both env names are set', () => {
      const svc = new AiServiceProxyService(
        new StubConfig({
          AI_SERVICE_URL: 'https://primary.example.com/v2/tariff',
          TARIFF_FORMULAS_API_URL: 'https://legacy.example.com/v2/tariff',
        }) as any,
      );
      expect(svc.describeUpstream().baseURL).toBe(
        'https://primary.example.com/v2/tariff',
      );
    });

    it('falls back to TARIFF_FORMULAS_API_URL', () => {
      const svc = new AiServiceProxyService(
        new StubConfig({
          TARIFF_FORMULAS_API_URL: 'https://legacy.example.com/v2/tariff',
        }) as any,
      );
      expect(svc.describeUpstream().baseURL).toBe(
        'https://legacy.example.com/v2/tariff',
      );
    });

    it('defaults to staging when neither env is set', () => {
      const svc = new AiServiceProxyService(new StubConfig({}) as any);
      expect(svc.describeUpstream().baseURL).toBe(
        'https://staging.api.report.chitchats.com/v2/tariff',
      );
    });
  });

  describe('safeStatus error translation', () => {
    let svc: AiServiceProxyService;

    beforeEach(() => {
      svc = new AiServiceProxyService(new StubConfig({}) as any);
    });

    function callPrivateSafeStatus(s?: number): number {
      return (svc as any).safeStatus(s);
    }

    it('translates upstream 401/403/429 to 502 (no auth leakage)', () => {
      expect(callPrivateSafeStatus(401)).toBe(502);
      expect(callPrivateSafeStatus(403)).toBe(502);
      expect(callPrivateSafeStatus(429)).toBe(502);
    });

    it('passes through 4xx (non-auth) and 5xx', () => {
      expect(callPrivateSafeStatus(400)).toBe(400);
      expect(callPrivateSafeStatus(404)).toBe(404);
      expect(callPrivateSafeStatus(422)).toBe(422);
      expect(callPrivateSafeStatus(500)).toBe(500);
      expect(callPrivateSafeStatus(503)).toBe(503);
    });

    it('defaults to 502 on missing status', () => {
      expect(callPrivateSafeStatus(undefined)).toBe(502);
    });
  });

  describe('empty input handling', () => {
    it('returns [] for getRates([]) without making a request', async () => {
      const svc = new AiServiceProxyService(new StubConfig({}) as any);
      const callOrThrowSpy = jest.spyOn(svc as any, 'callOrThrow');
      const out = await svc.getRates([]);
      expect(out).toEqual([]);
      expect(callOrThrowSpy).not.toHaveBeenCalled();
    });

    it('returns [] for getFormulas([]) without making a request', async () => {
      const svc = new AiServiceProxyService(new StubConfig({}) as any);
      const callOrThrowSpy = jest.spyOn(svc as any, 'callOrThrow');
      const out = await svc.getFormulas([]);
      expect(out).toEqual([]);
      expect(callOrThrowSpy).not.toHaveBeenCalled();
    });
  });

  describe('upstream failure surfaces as HttpException', () => {
    it('throws HttpException with safeStatus when axios rejects', async () => {
      const svc = new AiServiceProxyService(new StubConfig({}) as any);
      // Replace the internal axios client with a stub that rejects.
      (svc as any).client = {
        post: jest.fn().mockRejectedValue({
          message: 'connect ECONNREFUSED',
          response: { status: 503 },
        }),
      };
      await expect(
        svc.getRates([{ htsCode: '6109100040', country: 'CN' }]),
      ).rejects.toBeInstanceOf(HttpException);
    });
  });
});
