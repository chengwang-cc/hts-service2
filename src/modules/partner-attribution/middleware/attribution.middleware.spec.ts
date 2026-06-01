import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as jwt from 'jsonwebtoken';
import { AttributionMiddleware } from './attribution.middleware';
import { ApiKeyService } from '../../api-keys/services/api-key.service';
import { PartnerOriginCacheService } from '../services/partner-origin-cache.service';
import { PartnerResolverService } from '../services/partner-resolver.service';
import { PartnerUserEntity } from '../entities/partner-user.entity';

/**
 * Focused tests for end-user identity resolution. Partner-resolution paths
 * are covered indirectly via the live smoke test in P1 — here we exercise
 * the JWT verification (P2.1) and the asserted-id fallback.
 */
describe('AttributionMiddleware — end-user identity (P2.1)', () => {
  const PARTNER_ID = 'org-chitchats';
  const JWT_SECRET = 'sekret-chitchats-shared-secret-do-not-reuse';

  let mw: AttributionMiddleware;
  let configForPartner: jest.Mock;
  let validateApiKey: jest.Mock;
  let originResolve: jest.Mock;

  beforeEach(async () => {
    configForPartner = jest.fn();
    validateApiKey = jest.fn();
    originResolve = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AttributionMiddleware,
        {
          provide: ApiKeyService,
          useValue: { validateApiKey },
        },
        {
          provide: PartnerOriginCacheService,
          useValue: { resolve: originResolve },
        },
        {
          provide: PartnerResolverService,
          useValue: {
            configForPartner,
            unknownPartnerId: () => 'org-unknown',
          },
        },
        {
          provide: getRepositoryToken(PartnerUserEntity),
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockImplementation((x) => Promise.resolve({ ...x, id: 'pu-1' })),
            createQueryBuilder: jest.fn().mockReturnValue({
              update: () => ({
                set: () => ({ where: () => ({ execute: () => Promise.resolve() }) }),
              }),
            }),
          },
        },
      ],
    }).compile();
    mw = moduleRef.get(AttributionMiddleware);
  });

  const runMiddleware = async (headers: Record<string, string>): Promise<any> => {
    const req: any = { headers };
    const res: any = {};
    await new Promise<void>((resolve) => mw.use(req, res, () => resolve()));
    return req.attribution;
  };

  describe('JWT verification (X-Partner-User-Token)', () => {
    beforeEach(() => {
      originResolve.mockReturnValue({ organizationId: PARTNER_ID, pattern: '*.chitchats.com' });
      configForPartner.mockReturnValue({
        organizationId: PARTNER_ID,
        slug: 'chitchats',
        jwtSecret: JWT_SECRET,
      });
    });

    it('verifies a valid JWT and marks identity as verified', async () => {
      const token = jwt.sign({ sub: 'user-verified-001' }, JWT_SECRET, { algorithm: 'HS256' });
      const attr = await runMiddleware({
        origin: 'https://www.chitchats.com',
        'x-partner-user-token': token,
      });
      expect(attr.externalUserId).toBe('user-verified-001');
      expect(attr.userIdentitySource).toBe('verified');
      expect(attr.attributionSource).toBe('origin');
    });

    it('falls through to asserted id when JWT signature is wrong', async () => {
      const token = jwt.sign({ sub: 'user-bad' }, 'wrong-secret', { algorithm: 'HS256' });
      const attr = await runMiddleware({
        origin: 'https://www.chitchats.com',
        'x-partner-user-token': token,
        'x-partner-user-id': 'fallback-user',
      });
      expect(attr.externalUserId).toBe('fallback-user');
      expect(attr.userIdentitySource).toBe('asserted');
    });

    it('falls through when JWT is expired', async () => {
      const token = jwt.sign({ sub: 'user-stale' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: -10 });
      const attr = await runMiddleware({
        origin: 'https://www.chitchats.com',
        'x-partner-user-token': token,
      });
      expect(attr.externalUserId).toBeNull();
      expect(attr.userIdentitySource).toBeNull();
    });

    it('rejects the alg=none attack (token unsigned)', async () => {
      // jsonwebtoken refuses to sign with alg=none unless you pass null secret,
      // so we construct an unsigned JWS manually.
      const headerB64 = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify({ sub: 'attacker' })).toString('base64url');
      const noneToken = `${headerB64}.${payloadB64}.`;
      const attr = await runMiddleware({
        origin: 'https://www.chitchats.com',
        'x-partner-user-token': noneToken,
      });
      expect(attr.externalUserId).toBeNull();
      expect(attr.userIdentitySource).toBeNull();
    });

    it('ignores the token when the partner has no jwtSecret configured', async () => {
      configForPartner.mockReturnValue({
        organizationId: PARTNER_ID,
        slug: 'chitchats',
        jwtSecret: null,
      });
      const token = jwt.sign({ sub: 'user-x' }, JWT_SECRET, { algorithm: 'HS256' });
      const attr = await runMiddleware({
        origin: 'https://www.chitchats.com',
        'x-partner-user-token': token,
        'x-partner-user-id': 'asserted-user',
      });
      // Falls through to asserted
      expect(attr.externalUserId).toBe('asserted-user');
      expect(attr.userIdentitySource).toBe('asserted');
    });
  });

  describe('Asserted X-Partner-User-Id (no token)', () => {
    beforeEach(() => {
      originResolve.mockReturnValue({ organizationId: PARTNER_ID, pattern: '*.chitchats.com' });
      configForPartner.mockReturnValue({ organizationId: PARTNER_ID, slug: 'chitchats', jwtSecret: null });
    });

    it('reads the asserted id and labels the source', async () => {
      const attr = await runMiddleware({
        origin: 'https://www.chitchats.com',
        'x-partner-user-id': 'merchant-42',
      });
      expect(attr.externalUserId).toBe('merchant-42');
      expect(attr.userIdentitySource).toBe('asserted');
    });

    it('returns nulls when neither header is present', async () => {
      const attr = await runMiddleware({ origin: 'https://www.chitchats.com' });
      expect(attr.externalUserId).toBeNull();
      expect(attr.userIdentitySource).toBeNull();
    });
  });
});
